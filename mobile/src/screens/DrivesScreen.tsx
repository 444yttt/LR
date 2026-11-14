import { Text, View } from 'react-native';
import { displayLongDay, displayTime, drivesView, formatDistance, formatDuration, formatEfficiency, relativeTime } from '../garageModel.ts';
import { PressScale, Reveal, Skeleton } from '../ui/motion';
import { Card, Field, Headline, Note, Rule, SectionLabel, SubScreen, modelInput, useData } from '../ui/parts';
import { useNav } from '../ui/stack';
import { ink, medium, mute, regular, rule, semibold, typeStyle, useNow, usePx, white } from '../ui/theme';

const notReported = 'Not reported by the vehicle source';

export function DrivesScreen() {
  const px = usePx();
  const now = useNow();
  const data = useData();
  const nav = useNav();
  const view = drivesView(modelInput(data), now);
  return <SubScreen title="Recent drives" caption="Range Rover · verified trip end times (JST)">
    {view.kind === 'loading' ? <Card px={px} style={{ marginTop: px(24) }}>
      {[0, 1, 2].map(i => <View key={i}>
        {i > 0 && <Rule px={px} />}
        <View style={{ paddingHorizontal: px(14), paddingVertical: px(18) }}>
          <Skeleton width={px(64)} height={px(13)} radius={px(5)} />
          <Skeleton width={px(150)} height={px(9)} radius={px(4)} style={{ marginTop: px(10) }} />
        </View>
      </View>)}
    </Card>
      : view.kind !== 'list' ? <Card px={px} style={{ marginTop: px(24) }}>
        <Headline px={px} eyebrow="Drive history" title={view.kind === 'empty' ? 'No recent drives' : 'Not available'} caption={view.message} />
      </Card>
      : view.sections.map((section, s) => <Reveal key={section.key} index={s} delay={220}>
        <SectionLabel px={px} value={section.title} />
        <Card px={px} style={{ marginTop: px(10) }}>
          {section.drives.map((drive, i) => {
            const detail = [formatDuration(drive), formatDistance(drive)].filter(Boolean).join(' · ');
            return <View key={drive.endedAt}>
              {i > 0 && <Rule px={px} />}
              <PressScale accessibilityRole="button" accessibilityLabel={'Drive ended ' + displayTime(drive.endedAt) + (detail ? ', ' + detail : '')}
                onPress={() => nav.push({ name: 'drive', endedAt: drive.endedAt })}
                style={{ paddingHorizontal: px(14), paddingVertical: px(15), backgroundColor: white, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={typeStyle(px, 15, semibold, ink)}>{displayTime(drive.endedAt)}</Text>
                  <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>{'Trip ended' + (detail ? ' · ' + detail : '')}</Text>
                </View>
                <Text style={typeStyle(px, 23, regular, mute)}>›</Text>
              </PressScale>
            </View>;
          })}
        </Card>
      </Reveal>)}
    <Note px={px}>Only trip end times verified by the collector are listed. Routes and locations are never stored or shown.</Note>
  </SubScreen>;
}

export function DriveScreen({ endedAt }: { endedAt: string }) {
  const px = usePx();
  const now = useNow();
  const data = useData();
  const drive = data.snapshot?.lastDriveVerified ? data.snapshot.trips?.find(item => item.endedAt === endedAt) ?? null : null;
  if (!drive) {
    return <SubScreen title="Drive" caption="Range Rover">
      <Card px={px} style={{ marginTop: px(24) }}>
        <Headline px={px} eyebrow="Drive" title="Not available" caption="This drive is no longer in the verified history." />
      </Card>
    </SubScreen>;
  }
  const duration = formatDuration(drive);
  const distance = formatDistance(drive);
  const efficiency = formatEfficiency(drive);
  const ago = relativeTime(drive.endedAt, now);
  return <SubScreen title={'Drive · ' + displayTime(drive.endedAt)} caption={displayLongDay(drive.endedAt)}>
    <Card px={px} style={{ marginTop: px(24) }}>
      <View style={{ flexDirection: 'row' }}>
        <Cell px={px} label="Ended" value={displayTime(drive.endedAt) + ' JST'} caption={ago} />
        <View style={{ width: 1, backgroundColor: rule, marginVertical: px(18) }} />
        <Cell px={px} label="Duration" value={duration} />
      </View>
      <Rule px={px} />
      <View style={{ flexDirection: 'row' }}>
        <Cell px={px} label="Distance" value={distance} />
        <View style={{ width: 1, backgroundColor: rule, marginVertical: px(18) }} />
        <Cell px={px} label="Efficiency" value={efficiency} />
      </View>
    </Card>
    {!(duration && distance && efficiency) && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(12), marginHorizontal: px(8) })}>
      — {notReported}. The gateway currently reports the verified trip end time only.
    </Text>}
    <Card px={px}>
      <Field px={px} label="Source" value="JLR journeys · read-only" caption="End time verified by the Nostos collector" />
      {drive.startedAt && <>
        <Rule px={px} />
        <Field px={px} label="Started" value={displayTime(drive.startedAt) + ' JST'} />
      </>}
    </Card>
    <Note px={px}>Nostos keeps trip end times only. No route, start or end location is stored.</Note>
  </SubScreen>;
}

function Cell({ px, label, value, caption }: { px: (v: number) => number; label: string; value: string | null; caption?: string | null }) {
  return <View style={{ flex: 1, paddingHorizontal: px(14), paddingTop: px(20), paddingBottom: px(18) }}>
    <Text style={typeStyle(px, 10, medium, mute)}>{label.toUpperCase()}</Text>
    <Text style={typeStyle(px, 20, semibold, ink, { marginTop: px(10) })}>{value ?? '—'}</Text>
    {!!caption && <Text style={typeStyle(px, 12, regular, mute, { marginTop: px(4) })}>{caption}</Text>}
  </View>;
}
