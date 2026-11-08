import { FORCE_COLORS, FORCE_LABELS } from '../palette'
import { PAIR_TYPES, type PairType, type Weights } from '../types'
import { Section, Slider, Toggle } from './controls'

/** What each force's pairs are, as chosen: whose choice, and whether the data had a say in it. */
const CHOSEN_BY: Record<PairType, string> = {
  nb: "a digit's nearest in the data",
  mn: 'the second nearest of six drawn at random',
  fp: 'drawn at random (or, redrawn, from nearby on the map)',
}

const formatLean = (v: number) => (v === 0 ? 'even' : `${v > 0 ? 'chooser' : 'chosen'} ${Math.round(Math.abs(v) * 100)}%`)

interface Props {
  lean: Weights
  onLean: (type: PairType, lean: number) => void
  scrambled: boolean
  onScrambled: (on: boolean) => void
  /** How many neighbour pairs there are, and how many are one way. */
  oneWay: { count: number; of: number }
}

/** How each force is shared between the two ends of its pairs, and the null to compare against. */
export function LeanPanel({ lean, onLean, scrambled, onScrambled, oneWay }: Props) {
  const share = Math.round((oneWay.count / oneWay.of) * 100)
  return (
    <div className="flex flex-col gap-8">
      <p className="text-xs text-muted-foreground">
        Every pair is one digit's choice: its neighbours are its nearest in the data, say. PaCMAP pulls or pushes both ends
        of a pair equally, so the map settles. Leaning a force gives more of it to the digit that chose the pair, and less
        to the one chosen, keeping its sign and its total. Where two digits chose each other the leans cancel, so only
        one-way relationships in the data move differently: {oneWay.count.toLocaleString()} of{' '}
        {oneWay.of.toLocaleString()} neighbour pairs ({share}%) here. Each pushes both its digits on, from the chooser
        towards the one chosen, and the map keeps moving where they add up.
      </p>
      <Section title="Lean" description="Toward the digit that chose each pair (right), or the one chosen (left). Even is PaCMAP's.">
        {PAIR_TYPES.map((type) => (
          <div key={type} className="flex flex-col gap-1">
            <Slider
              label={FORCE_LABELS[type]}
              value={lean[type]}
              min={-1}
              max={1}
              step={0.05}
              onChange={(v) => onLean(type, v)}
              format={formatLean}
              title={`${FORCE_LABELS[type]} pairs are chosen as ${CHOSEN_BY[type]}.`}
            />
            <span className="ml-[6.5rem] pl-3 text-[11px] text-muted-foreground" style={{ borderLeft: `2px solid ${FORCE_COLORS[type]}` }}>
              chosen as {CHOSEN_BY[type]}
            </span>
          </div>
        ))}
      </Section>
      <Section
        title="Null"
        description="Turns each one-way neighbour pair round, or not, at random: the same digits pair, but the data no longer says which chose which. Motion that stays is the lean's own; motion that goes was the data's. Mid-near and far pairs are already drawn at random by their chooser, so need no scrambling. With no lean it changes nothing."
      >
        <Toggle label="scramble who chose whom" checked={scrambled} onChange={onScrambled} />
      </Section>
    </div>
  )
}
