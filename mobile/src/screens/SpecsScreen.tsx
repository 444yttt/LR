import { useEffect, useRef, useState } from 'react';
import { Keyboard, TextInput, View, type KeyboardTypeOptions, type ReturnKeyTypeOptions, type TextInputProps } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { VEHICLES } from '../garageModel.ts';
import { capacityText, isEmptySpecs, normalizeSpecs, parseCapacityText, sameSpecs, specLimits, specsFor, type VehicleSpecs } from '../vehicleSpecs.ts';
import { energyOf } from '../fuelLog.ts';
import { PressScale, haptics, useMotion } from '../ui/motion';
import { Card, Note, Rule, SectionLabel, SubScreen, useFeed, useForm } from '../ui/parts';
import { useSpecs, useSpecsStore } from '../ui/specs';
import { useNav } from '../ui/stack';
import { Label, ink, medium, mute, regular, semibold, typeStyle, useFontCap, usePx, white, type Px } from '../ui/theme';

type Option = { key: number; text: string };
type Draft = { grade: string; engine: string; year: string; options: Option[]; capacity: string };

let nextOption = 0;
const draftOf = (specs: VehicleSpecs): Draft => ({
  grade: specs.grade, engine: specs.engine, year: specs.year, options: specs.options.map(text => ({ key: nextOption++, text })),
  capacity: capacityText(specs.capacity),
});
const specsOf = (draft: Draft, capacity: number | null): VehicleSpecs =>
  normalizeSpecs({ ...draft, options: draft.options.map(option => option.text), capacity });

/**
 * Vehicle specs editor: grade / trim, engine / powertrain, model year and a free list of options, all plain text the
 * owner types, plus the tank (or, for an EV, usable battery) capacity used by the fuel-economy estimate. Nothing is
 * pre-filled from the vehicle table or telemetry; empty fields show an "Unknown" placeholder.
 * "Save" sits in the NavBar's trailing slot (the same spot as "Update now"), stores the specs on this device and
 * returns to the vehicle. Back (button or edge swipe) leaves without saving.
 */
export function SpecsScreen({ vehicle }: { vehicle: number }) {
  const px = usePx();
  const nav = useNav();
  const info = VEHICLES[vehicle];
  const store = useSpecsStore();
  const stored = useSpecs(vehicle);
  const [draft, setDraft] = useState<Draft>(() => draftOf(stored));
  const touched = useRef(false);
  const [loaded, setLoaded] = useState(false);
  // Storage may still be loading when the screen opens (deep link at launch): take the stored value once it arrives.
  useEffect(() => {
    let alive = true;
    void store.ready.then(() => {
      if (!alive) return;
      if (!touched.current) setDraft(draftOf(specsFor(store.current(), info.id)));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);
  const edit = (change: Partial<Draft>) => { touched.current = true; setDraft(current => ({ ...current, ...change })); };
  const engine = useRef<TextInput>(null);
  const year = useRef<TextInput>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const electric = energyOf(info, useFeed(vehicle)?.snapshot ?? null) === 'electric';

  const capacity = parseCapacityText(draft.capacity);
  const next = specsOf(draft, capacity === 'invalid' ? null : capacity);
  // A capacity that is not a number in range blocks Save (with a message) rather than being dropped silently.
  const dirty = loaded && capacity !== 'invalid' && !sameSpecs(next, stored);
  const save = () => {
    if (!dirty) return;
    Keyboard.dismiss();
    haptics.success();
    void store.save(vehicle, next);
    nav.pop();
  };
  const addOption = () => {
    const key = nextOption++;
    setFocusKey(key);
    edit({ options: [...draft.options, { key, text: '' }] });
  };

  return <SubScreen form title="Vehicle specs" caption={info.name} back="Back"
    trailing={<SaveButton px={px} enabled={dirty} onPress={save} />}>
    <Card px={px} style={{ marginTop: px(24) }}>
      <SpecField px={px} label="Grade / trim" value={draft.grade} max={specLimits.grade} onChange={grade => edit({ grade })}
        returnKeyType="next" onSubmit={() => engine.current?.focus()} />
      <Rule px={px} />
      <SpecField px={px} inputRef={engine} label="Engine / powertrain" value={draft.engine} max={specLimits.engine} onChange={value => edit({ engine: value })}
        returnKeyType="next" onSubmit={() => year.current?.focus()} />
      <Rule px={px} />
      <SpecField px={px} inputRef={year} label="Model year" value={draft.year} max={specLimits.year} onChange={value => edit({ year: value })}
        keyboardType="numbers-and-punctuation" returnKeyType="done" onSubmit={() => Keyboard.dismiss()} />
    </Card>

    <SectionLabel px={px} value="Options" />
    <Card px={px} style={{ marginTop: px(10) }}>
      {draft.options.map((option, i) => <OptionRow key={option.key} px={px} index={i} value={option.text} autoFocus={option.key === focusKey}
        onChange={text => edit({ options: draft.options.map(item => item.key === option.key ? { ...item, text } : item) })}
        onRemove={() => edit({ options: draft.options.filter(item => item.key !== option.key) })}
        onSubmit={() => { if (option.text.trim() && i === draft.options.length - 1) addOption(); else Keyboard.dismiss(); }} />)}
      {draft.options.length > 0 && draft.options.length < specLimits.options && <Rule px={px} />}
      {draft.options.length < specLimits.options && <PressScale accessibilityRole="button" accessibilityLabel="Add option" onPress={addOption}
        style={{ paddingHorizontal: px(14), minHeight: px(52), flexDirection: 'row', alignItems: 'center' }}>
        <Label style={typeStyle(px, 18, regular, ink, { width: px(22) })}>＋</Label>
        <Label style={typeStyle(px, 15, medium, ink)}>Add option</Label>
      </PressScale>}
    </Card>

    <SectionLabel px={px} value={electric ? 'Efficiency' : 'Fuel economy'} />
    <Card px={px} style={{ marginTop: px(10) }}>
      <FormField px={px} label={electric ? 'Battery capacity (kWh)' : 'Tank capacity (L)'} value={draft.capacity}
        onChange={value => edit({ capacity: value })} max={6} keyboardType="decimal-pad" returnKeyType="done" onSubmit={() => Keyboard.dismiss()}
        error={capacity === 'invalid' ? 'Enter a number between ' + specLimits.capacityMin + ' and ' + specLimits.capacityMax : undefined}
        caption={'Optional. Used only to estimate economy from ' + (electric ? 'charge-level' : 'fuel-level') + ' readings; never read from the vehicle.'} />
    </Card>

    <Note px={px}>{'Entered by you and stored only on this device. Nothing here is read from or sent to the vehicle. '
      + (isEmptySpecs(next) ? 'Leave everything empty to show only the vehicle name.' : 'Empty fields are not shown.')}</Note>
  </SubScreen>;
}

/** NavBar trailing action, styled like "Update now" so the slot reads the same on every screen. */
export function NavButton({ px, label, hint, enabled = true, onPress }: { px: Px; label: string; hint: string; enabled?: boolean; onPress: () => void }) {
  return <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{ disabled: !enabled }} disabled={!enabled} hitSlop={8} onPress={onPress}
    style={{ height: px(32), paddingHorizontal: px(16), borderRadius: px(16), backgroundColor: white, justifyContent: 'center' }}>
    <Label numberOfLines={1} style={typeStyle(px, 12, medium, enabled ? ink : mute)}>{label}</Label>
  </PressScale>;
}

export const SaveButton = ({ px, enabled, onPress, hint = 'Saves the specs on this device' }: { px: Px; enabled: boolean; onPress: () => void; hint?: string }) =>
  <NavButton px={px} label="Save" hint={hint} enabled={enabled} onPress={onPress} />;

function useInputStyle(px: Px) {
  return { cap: useFontCap(), style: { ...typeStyle(px, 15, semibold, ink), lineHeight: undefined, paddingVertical: px(6), paddingHorizontal: 0 } };
}

const SpecField = (props: Parameters<typeof FormField>[0]) => <FormField {...props} />;

/**
 * A labelled text field inside a form card: eyebrow label, the input, then an optional error (ink, takes the
 * caption's place) or caption. Focus scrolls it clear of the keyboard (SubScreen `form`).
 */
export function FormField({ px, label, value, onChange, max, inputRef, keyboardType, returnKeyType, onSubmit, placeholder = 'Unknown', caption, error,
  autoCapitalize = 'words', children }: {
  px: Px; label: string; value: string; onChange: (value: string) => void; max: number; inputRef?: React.RefObject<TextInput | null>;
  keyboardType?: KeyboardTypeOptions; returnKeyType?: ReturnKeyTypeOptions; onSubmit?: () => void; placeholder?: string;
  caption?: string; error?: string; autoCapitalize?: TextInputProps['autoCapitalize']; children?: React.ReactNode;
}) {
  const { reveal } = useForm();
  const input = useInputStyle(px);
  return <View style={{ paddingHorizontal: px(14), paddingTop: px(14), paddingBottom: px(8) }}>
    <Label style={typeStyle(px, 10, medium, mute)}>{label.toUpperCase()}</Label>
    <TextInput ref={inputRef} accessibilityLabel={label} accessibilityHint={error} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={mute}
      maxLength={max} autoCorrect={false} autoCapitalize={autoCapitalize} spellCheck={false} keyboardType={keyboardType} returnKeyType={returnKeyType}
      submitBehavior={returnKeyType === 'next' ? 'submit' : 'blurAndSubmit'} onSubmitEditing={onSubmit} onFocus={reveal} clearButtonMode="while-editing"
      maxFontSizeMultiplier={input.cap} selectionColor={ink} style={[input.style, { marginTop: px(2) }]} />
    {children}
    {error ? <Label accessibilityLiveRegion="polite" style={typeStyle(px, 12, medium, ink, { marginTop: px(2), marginBottom: px(6) })}>{error}</Label>
      : caption ? <Label style={typeStyle(px, 12, regular, mute, { marginTop: px(2), marginBottom: px(6) })}>{caption}</Label> : null}
  </View>;
}

function OptionRow({ px, index, value, autoFocus, onChange, onRemove, onSubmit }: {
  px: Px; index: number; value: string; autoFocus: boolean; onChange: (value: string) => void; onRemove: () => void; onSubmit: () => void;
}) {
  const { reduced } = useMotion();
  const { reveal } = useForm();
  const input = useInputStyle(px);
  const name = value.trim() || 'empty option';
  // A light fade for added / removed rows; none under Reduce Motion.
  return <Animated.View entering={reduced ? undefined : FadeIn.duration(180)} exiting={reduced ? undefined : FadeOut.duration(140)}>
    {index > 0 && <Rule px={px} />}
    <View style={{ paddingLeft: px(14), minHeight: px(52), flexDirection: 'row', alignItems: 'center' }}>
      <TextInput accessibilityLabel={'Option ' + (index + 1)} value={value} onChangeText={onChange} placeholder="Option" placeholderTextColor={mute}
        maxLength={specLimits.option} autoFocus={autoFocus} autoCorrect={false} returnKeyType="next" submitBehavior="submit"
        onSubmitEditing={onSubmit} onFocus={reveal} maxFontSizeMultiplier={input.cap} selectionColor={ink}
        style={[input.style, { flex: 1, fontFamily: regular }]} />
      <PressScale accessibilityRole="button" accessibilityLabel={'Remove ' + name} hitSlop={6} scale={0.86} onPress={onRemove}
        style={{ width: px(48), height: px(52), alignItems: 'center', justifyContent: 'center' }}>
        <Label style={typeStyle(px, 20, regular, mute)}>×</Label>
      </PressScale>
    </View>
  </Animated.View>;
}
