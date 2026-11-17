import { useEffect, useRef, useState } from 'react';
import { Keyboard, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { VEHICLES } from '../garageModel.ts';
import {
  amountUnit, convertEconomy, draftOfEntry, energyOf, entryFromDraft, formatAmount, formatDay, formatEconomy, formatKm, formatPrice,
  logEconomy, logFor, newEntryId, todayJst, unitLabel, unitPrice, type DraftErrors, type EconomyUnit, type Energy, type EntryDraft, type Segment,
} from '../fuelLog.ts';
import { estimateFromHistory, MIN_DISTANCE_KM } from '../fuelEstimate.ts';
import type { HistoryLoad } from '../gatewayVehicles.ts';
import { CountUp, PressScale, Skeleton, Toggle, haptics, useMotion } from '../ui/motion';
import { Card, Headline, Note, Rule, SectionLabel, SubScreen, useData, useFeed } from '../ui/parts';
import { useFuelLog, useFuelLogStore } from '../ui/fuelLog';
import { useSpecs } from '../ui/specs';
import { useNav } from '../ui/stack';
import { Label, ink, medium, mute, regular, rule, semibold, typeStyle, useNow, usePx, white, type Px } from '../ui/theme';
import { FormField, NavButton, SaveButton } from './SpecsScreen';

/** Detail row / screen title: "Fuel economy", or "Efficiency" for an electric vehicle. */
export const economyTitle = (energy: Energy) => energy === 'electric' ? 'Efficiency' : 'Fuel economy';

type HistoryState = { kind: 'loading' } | { kind: 'none' } | HistoryLoad;

/**
 * Fuel economy (or EV efficiency) for one vehicle, from three sources that are never mixed into one number:
 * the owner's refuel log (full-tank method, works on this device today), an estimate from telemetry history (needs
 * the owner's tank capacity and a gateway history that spans a refuel), and a value reported by the vehicle (none of
 * the current sources reports one). Every source that cannot give a value says why, instead of showing a number.
 */
export function EconomyScreen({ vehicle }: { vehicle: number }) {
  const px = usePx();
  const nav = useNav();
  const data = useData();
  const info = VEHICLES[vehicle];
  const feed = useFeed(vehicle);
  const energy = energyOf(info, feed?.snapshot ?? null);
  const log = useFuelLog(vehicle);
  const { unit, setUnit } = useFuelLogStore();
  const capacity = useSpecs(vehicle).capacity;
  const fromLog = logEconomy(log);
  const history = useHistory(vehicle, info.connected);
  const estimate = history.kind === 'ok' ? estimateFromHistory(history.points, capacity, energy) : null;
  const electric = energy === 'electric';
  const add = () => nav.push({ name: 'refuel', vehicle });

  return <SubScreen title={economyTitle(energy)} caption={info.name}
    trailing={<NavButton px={px} label={electric ? 'Add charge' : 'Add refuel'} hint="Adds an entry to the log on this device" onPress={add} />}>
    <UnitSwitch px={px} energy={energy} unit={unit} onChange={setUnit} />

    <SectionLabel px={px} value="From your log" />
    <Card px={px} style={{ marginTop: px(10) }}>
      {fromLog ? <>
        <Pair px={px} energy={energy} unit={unit} latest={fromLog.latest.economy} average={fromLog.average}
          latestCaption={'Full ' + (electric ? 'charge' : 'tank') + ' · ' + formatDay(fromLog.latest.endDate)}
          averageCaption={fromLog.segments.length + (fromLog.segments.length === 1 ? ' fill · ' : ' fills · ') + formatKm(sum(fromLog.segments.map(s => s.distanceKm)))} />
        <Rule px={px} />
        <SegmentBars px={px} segments={fromLog.segments} energy={energy} unit={unit} />
      </> : <Headline px={px} eyebrow={electric ? 'Full-charge method' : 'Full-tank method'} title={log.length ? 'Not enough entries' : 'No entries yet'}
        caption={'Economy appears after two entries ' + (electric ? 'charged' : 'filled') + ' to full. Add every ' + (electric ? 'charge' : 'fill')
          + (log.length ? '; ' + (electric ? 'partial charges' : 'partial fills') + ' count toward the next full one.' : ', starting with the next full ' + (electric ? 'charge.' : 'tank.'))} />}
    </Card>

    <SectionLabel px={px} value="Estimate from telemetry" />
    <Card px={px} style={{ marginTop: px(10) }}>
      {!info.connected || history.kind === 'noSource'
        ? <Headline px={px} eyebrow="Telemetry" title="Not available" caption="No vehicle data source is connected." />
        : capacity === null ? <>
          <Headline px={px} eyebrow="Telemetry" title={electric ? 'Battery capacity needed' : 'Tank capacity needed'}
            caption={'Enter the ' + (electric ? 'usable battery capacity' : 'tank capacity') + ' in Vehicle specs to estimate economy from '
              + (electric ? 'charge-level' : 'fuel-level') + ' readings. Nothing is assumed.'} />
          <Rule px={px} />
          <PressScale accessibilityRole="button" accessibilityLabel="Enter capacity in Vehicle specs" onPress={() => nav.push({ name: 'specs', vehicle })}
            style={{ paddingHorizontal: px(14), minHeight: px(52), flexDirection: 'row', alignItems: 'center' }}>
            <Label style={typeStyle(px, 15, medium, ink, { flex: 1 })}>Vehicle specs</Label>
            <Label style={typeStyle(px, 23, regular, mute)}>›</Label>
          </PressScale>
        </>
        : history.kind === 'loading' ? <View style={{ paddingHorizontal: px(14), paddingVertical: px(22) }}>
          <Skeleton width={px(72)} height={px(9)} radius={px(4)} />
          <Skeleton width={px(150)} height={px(20)} radius={px(6)} style={{ marginTop: px(14) }} />
        </View>
        : estimate?.kind === 'ok' ? <>
          <Pair px={px} energy={energy} unit={unit} latest={estimate.latest.economy} average={estimate.average}
            latestCaption={'Since ' + (electric ? 'charge' : 'refuel') + ' · ' + formatKm(estimate.latest.distanceKm)}
            averageCaption={estimate.stretches.length + (estimate.stretches.length === 1 ? ' stretch' : ' stretches') + ' · ' + estimate.points + ' readings'} />
          <Label style={typeStyle(px, 12, regular, mute, { marginHorizontal: px(14), marginBottom: px(18) })}>
            {'Estimate: ' + (electric ? 'charge-level' : 'fuel-level') + ' drop × your ' + capacity + ' ' + amountUnit(energy)
              + ' capacity. Level readings are whole percents, so treat it as approximate.'}
          </Label>
        </>
        : <Headline px={px} eyebrow="Telemetry" {...historyCopy(history, electric)} />}
    </Card>

    <SectionLabel px={px} value="Reported by the vehicle" />
    <Card px={px} style={{ marginTop: px(10) }}>
      <Headline px={px} eyebrow={feed ? info.source : 'Vehicle'} title="Not reported"
        caption={feed ? (info.source.startsWith('Nostos') ? 'The ' : '') + info.source + ' does not report ' + (electric ? 'energy' : 'fuel') + ' consumption for this vehicle.' : 'No vehicle data source is connected.'} />
    </Card>

    {log.length > 0 && <>
      <SectionLabel px={px} value="Log" />
      <Card px={px} style={{ marginTop: px(10) }}>
        {[...log].reverse().map((entry, i) => {
          const segment = fromLog?.segments.find(s => s.endId === entry.id);
          const perUnit = unitPrice(entry);
          const detail = [formatAmount(entry.amount, energy), formatKm(entry.odometerKm),
            entry.price !== null ? formatPrice(entry.price) + (perUnit !== null ? ' (' + formatPrice(perUnit) + '/' + amountUnit(energy) + ')' : '') : null,
            entry.full ? 'Full' : 'Partial'].filter(Boolean).join(' · ');
          return <LogRow key={entry.id} px={px} first={i === 0} date={formatDay(entry.date)} detail={detail}
            value={segment ? formatEconomy(segment.economy, energy, unit) : null} onPress={() => nav.push({ name: 'refuel', vehicle, entry: entry.id })} />;
        })}
      </Card>
    </>}

    <Note px={px}>{'Log entries are entered by you and stored only on this device. Full-tank method: distance between two full '
      + (electric ? 'charges' : 'fills') + ' ÷ everything added after the first, up to and including the second. The telemetry estimate and the log are separate sources and are never combined.'}</Note>
  </SubScreen>;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function historyCopy(history: HistoryState, electric: boolean): { title: string; caption: string } {
  switch (history.kind) {
    case 'signedOut': return { title: 'Not available', caption: 'Sign in to read telemetry history.' };
    case 'unavailable': return { title: 'Not available', caption: 'Telemetry history could not be loaded. Try again later.' };
    case 'none': return { title: 'Not available', caption: 'Telemetry history is not available in this build.' };
    default: return { title: 'Not enough data yet', caption: 'Readings are recorded each time the collector updates the vehicle. An estimate appears once the history includes a '
      + (electric ? 'charge' : 'refuel') + ' and at least ' + MIN_DISTANCE_KM + ' km of driving after it.' };
  }
}

/** Reads the gateway history for this vehicle when the screen opens and after every successful vehicle update. */
function useHistory(vehicle: number, connected: boolean): HistoryState {
  const data = useData();
  const load = data.loadHistory;
  const [state, setState] = useState<HistoryState>(() => !connected ? { kind: 'noSource' } : load ? { kind: 'loading' } : { kind: 'none' });
  useEffect(() => {
    if (!connected || !load) return;
    let alive = true;
    load(vehicle).then(result => { if (alive) setState(result); }, () => { if (alive) setState({ kind: 'unavailable' }); });
    return () => { alive = false; };
  }, [vehicle, connected, load, data.lastSyncedAt]);
  return state;
}

function UnitSwitch({ px, energy, unit, onChange }: { px: Px; energy: Energy; unit: EconomyUnit; onChange: (unit: EconomyUnit) => void }) {
  const options: EconomyUnit[] = ['perUnit', 'per100'];
  return <View accessibilityRole="radiogroup" style={{ marginTop: px(24), alignSelf: 'flex-start', flexDirection: 'row', padding: px(3), borderRadius: px(19), backgroundColor: white }}>
    {options.map(option => {
      const selected = option === unit;
      return <PressScale key={option} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={unitLabel(energy, option)}
        onPress={() => { if (!selected) onChange(option); }}
        style={{ minHeight: px(32), paddingHorizontal: px(14), borderRadius: px(16), justifyContent: 'center', backgroundColor: selected ? ink : white }}>
        <Label style={typeStyle(px, 12, medium, selected ? white : mute)}>{unitLabel(energy, option)}</Label>
      </PressScale>;
    })}
  </View>;
}

/** Latest and average side by side. A newly computed latest value counts up (CountUp; static under Reduce Motion). */
function Pair({ px, energy, unit, latest, average, latestCaption, averageCaption }: {
  px: Px; energy: Energy; unit: EconomyUnit; latest: number; average: number; latestCaption: string; averageCaption: string;
}) {
  const label = unitLabel(energy, unit);
  return <View style={{ flexDirection: 'row' }}>
    <View testID="economy-latest" accessible accessibilityLabel={'Latest ' + formatEconomy(latest, energy, unit)} style={{ flex: 1, paddingHorizontal: px(14), paddingTop: px(20), paddingBottom: px(18) }}>
      <Label style={typeStyle(px, 10, medium, mute)}>LATEST</Label>
      <View style={{ marginTop: px(10) }}>
        <CountUp value={convertEconomy(latest, unit)} decimals={1} suffix={' ' + label} empty="—" style={typeStyle(px, 22, semibold, ink)} />
      </View>
      <Label style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>{latestCaption}</Label>
    </View>
    <View style={{ width: 1, backgroundColor: rule, marginVertical: px(18) }} />
    <View testID="economy-average" accessible accessibilityLabel={'Average ' + formatEconomy(average, energy, unit)} style={{ flex: 1, paddingHorizontal: px(14), paddingTop: px(20), paddingBottom: px(18) }}>
      <Label style={typeStyle(px, 10, medium, mute)}>AVERAGE</Label>
      <Label style={typeStyle(px, 22, semibold, ink, { marginTop: px(10) })}>{formatEconomy(average, energy, unit)}</Label>
      <Label style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>{averageCaption}</Label>
    </View>
  </View>;
}

/**
 * Per-fill history as thin ink bars on a rule baseline (single series: no legend; the log list below is the table
 * view). Rounded data ends, 2pt gaps, one direct label on the latest bar only.
 */
function SegmentBars({ px, segments, energy, unit }: { px: Px; segments: Segment[]; energy: Energy; unit: EconomyUnit }) {
  const shown = segments.slice(-8);
  const values = shown.map(s => convertEconomy(s.economy, unit) ?? 0);
  const max = Math.max(...values);
  const height = 56;
  const label = unitLabel(energy, unit);
  return <View accessible accessibilityLabel={'Economy per full ' + (energy === 'electric' ? 'charge' : 'tank') + ', oldest to newest: '
    + values.map(v => v.toFixed(1)).join(', ') + ' ' + label} style={{ paddingHorizontal: px(14), paddingTop: px(14), paddingBottom: px(16) }}>
    <Label style={typeStyle(px, 10, medium, mute)}>{'PER FILL · ' + label.toUpperCase()}</Label>
    <View style={{ height: px(height + 18), marginTop: px(8), flexDirection: 'row', alignItems: 'flex-end' }}>
      {values.map((value, i) => {
        const last = i === values.length - 1;
        return <View key={shown[i].endId} style={{ width: px(22), marginRight: px(i === values.length - 1 ? 0 : 6), alignItems: 'center' }}>
          {last && <Label numberOfLines={1} style={typeStyle(px, 10, medium, ink, { marginBottom: px(4), width: px(60), textAlign: 'center' })}>{value.toFixed(1)}</Label>}
          <View style={{ width: px(14), height: Math.max(px(2), px(height) * (max > 0 ? value / max : 0)), borderTopLeftRadius: px(4), borderTopRightRadius: px(4),
            backgroundColor: last ? ink : mute }} />
        </View>;
      })}
    </View>
    <View style={{ height: 1, backgroundColor: rule }} />
  </View>;
}

function LogRow({ px, first, date, detail, value, onPress }: { px: Px; first: boolean; date: string; detail: string; value: string | null; onPress: () => void }) {
  const { reduced } = useMotion();
  // New rows fade in; nothing moves under Reduce Motion.
  return <Animated.View entering={reduced ? undefined : FadeIn.duration(220)}>
    {!first && <Rule px={px} />}
    <PressScale accessibilityRole="button" accessibilityLabel={date + ', ' + detail + (value ? ', ' + value : '')} accessibilityHint="Edits this entry" onPress={onPress}
      style={{ paddingHorizontal: px(14), paddingVertical: px(14), flexDirection: 'row', alignItems: 'center', backgroundColor: white }}>
      <View style={{ flex: 1 }}>
        <Label style={typeStyle(px, 15, semibold, ink)}>{date}</Label>
        <Label style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>{detail}</Label>
      </View>
      {value && <Label style={typeStyle(px, 13, medium, ink, { marginLeft: px(8) })}>{value}</Label>}
      <Label style={typeStyle(px, 23, regular, mute, { marginLeft: px(8) })}>›</Label>
    </PressScale>
  </Animated.View>;
}

const emptyDraft = (today: string): EntryDraft => ({ date: today, amount: '', odometer: '', price: '', full: true });

/**
 * Refuel (or charge) log entry: date, litres / kWh, odometer, optional total price, filled-to-full. Save in the
 * NavBar trailing slot validates, stores on this device and returns; Back (button or edge swipe) leaves without
 * saving. The latest odometer from the vehicle is only offered as a tap-to-fill suggestion, never pre-filled.
 */
export function RefuelScreen({ vehicle, entryId }: { vehicle: number; entryId?: string }) {
  const px = usePx();
  const nav = useNav();
  const now = useNow();
  const info = VEHICLES[vehicle];
  const feed = useFeed(vehicle);
  const energy = energyOf(info, feed?.snapshot ?? null);
  const electric = energy === 'electric';
  const store = useFuelLogStore();
  const stored = useFuelLog(vehicle).find(entry => entry.id === entryId) ?? null;
  const today = todayJst(now);
  const [draft, setDraft] = useState<EntryDraft>(() => stored ? draftOfEntry(stored) : emptyDraft(today));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [missing, setMissing] = useState(false);
  const touched = useRef(false);
  const [loaded, setLoaded] = useState(false);
  // A deep link at launch may open the editor before storage is read: take the stored entry once it arrives.
  useEffect(() => {
    let alive = true;
    void store.ready.then(() => {
      if (!alive) return;
      if (entryId) {
        const entry = logFor(store.current(), info.id).find(item => item.id === entryId);
        if (!entry) setMissing(true);
        else if (!touched.current) setDraft(draftOfEntry(entry));
      }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);
  const edit = (change: Partial<EntryDraft>) => {
    touched.current = true;
    setDraft(current => ({ ...current, ...change }));
    // A field's message clears as soon as it is edited.
    setErrors(current => {
      const next = { ...current };
      for (const key of Object.keys(change)) delete next[key as keyof DraftErrors];
      return next;
    });
  };
  const amount = useRef<TextInput>(null);
  const odometer = useRef<TextInput>(null);
  const price = useRef<TextInput>(null);
  const ready = loaded && !missing && draft.amount.trim() !== '' && draft.odometer.trim() !== '' && draft.date.trim() !== '';
  const save = () => {
    if (!ready) return;
    const result = entryFromDraft(draft, entryId ?? newEntryId(Date.now()), energy, today);
    if (result.errors) {
      haptics.warning();
      setErrors(result.errors);
      return;
    }
    Keyboard.dismiss();
    haptics.success();
    void store.save(vehicle, result.entry);
    nav.pop();
  };
  // Delete asks once more on the same row ("Tap again to delete"), so a stray tap cannot remove an entry.
  const [confirming, setConfirming] = useState(false);
  const remove = () => {
    if (!entryId) return;
    if (!confirming) { setConfirming(true); return; }
    Keyboard.dismiss();
    haptics.warning();
    void store.remove(vehicle, entryId);
    nav.pop();
  };
  const latestOdometer = feed?.snapshot?.odometerKm ?? null;
  const unit = amountUnit(energy);

  return <SubScreen form title={entryId ? 'Edit entry' : electric ? 'Add charge' : 'Add refuel'} caption={info.name} back="Back"
    trailing={<SaveButton px={px} enabled={ready} onPress={save} hint="Saves the entry on this device" />}>
    {missing ? <Card px={px} style={{ marginTop: px(24) }}>
      <Headline px={px} eyebrow="Log" title="Not available" caption="This entry is no longer in the log." />
    </Card> : <>
      <Card px={px} style={{ marginTop: px(24) }}>
        <FormField px={px} label="Date" value={draft.date} max={10} placeholder="YYYY-MM-DD" autoCapitalize="none" error={errors.date}
          keyboardType="numbers-and-punctuation" returnKeyType="next" onChange={date => edit({ date })} onSubmit={() => amount.current?.focus()} />
        <Rule px={px} />
        <FormField px={px} inputRef={amount} label={electric ? 'Energy added (kWh)' : 'Fuel added (L)'} value={draft.amount} max={8} placeholder={'0.0 ' + unit}
          error={errors.amount} keyboardType="decimal-pad" returnKeyType="next" onChange={value => edit({ amount: value })} onSubmit={() => odometer.current?.focus()} />
        <Rule px={px} />
        <FormField px={px} inputRef={odometer} label="Odometer (km)" value={draft.odometer} max={10} placeholder={electric ? 'Reading at the charge' : 'Reading at the fill'} error={errors.odometer}
          keyboardType="number-pad" returnKeyType="next" onChange={value => edit({ odometer: value })} onSubmit={() => price.current?.focus()}>
          {latestOdometer !== null && draft.odometer.trim() === '' && <PressScale accessibilityRole="button"
            accessibilityLabel={'Use the latest vehicle reading, ' + formatKm(latestOdometer)} onPress={() => edit({ odometer: String(latestOdometer) })}
            style={{ alignSelf: 'flex-start', marginTop: px(6), marginBottom: px(4), paddingHorizontal: px(12), minHeight: px(30), borderRadius: px(15),
              borderWidth: 1, borderColor: rule, justifyContent: 'center' }}>
            <Label style={typeStyle(px, 12, medium, ink)}>{'Use latest reading · ' + formatKm(latestOdometer)}</Label>
          </PressScale>}
        </FormField>
        <Rule px={px} />
        <FormField px={px} inputRef={price} label="Total price (¥) · optional" value={draft.price} max={10} placeholder="Not entered" error={errors.price}
          keyboardType="decimal-pad" returnKeyType="done" onChange={value => edit({ price: value })} onSubmit={() => Keyboard.dismiss()}
          caption={electric ? 'What you paid for this charge in total, not per kWh.' : 'What you paid for this fill in total, not per litre.'} />
      </Card>

      <Card px={px}>
        <View style={{ paddingHorizontal: px(14), paddingVertical: px(15), flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, marginRight: px(12) }}>
            <Label style={typeStyle(px, 15, medium, ink)}>{electric ? 'Charged to full' : 'Filled to full'}</Label>
            <Label style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>
              {'Economy is measured between full ' + (electric ? 'charges' : 'fills') + '. Turn off for a partial ' + (electric ? 'charge' : 'fill') + '; it counts toward the next full one.'}
            </Label>
          </View>
          <Toggle px={px} label={electric ? 'Charged to full' : 'Filled to full'} value={draft.full} onChange={full => edit({ full })} />
        </View>
      </Card>

      {entryId && <Card px={px}>
        <PressScale accessibilityRole="button" accessibilityLabel={confirming ? 'Tap again to delete' : 'Delete entry'} accessibilityHint="Removes this entry from the log" onPress={remove}
          style={{ paddingHorizontal: px(14), minHeight: px(52), justifyContent: 'center' }}>
          <Label style={typeStyle(px, 15, medium, ink)}>{confirming ? 'Tap again to delete' : 'Delete entry'}</Label>
        </PressScale>
      </Card>}
    </>}

    <Note px={px}>Entered by you and stored only on this device. Nothing here is read from or sent to the vehicle.</Note>
  </SubScreen>;
}
