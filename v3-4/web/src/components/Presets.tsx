import { Download, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import type { PresetStore } from '../usePresets'
import { Section } from './controls'
import { Button } from './ui/button'

/** Save the page's settings under a name and load them back, carry them between browsers as files, or reset them. */
export function PresetsPanel({ store, onReset }: { store: PresetStore; onReset: () => void }) {
  const { presets, selected, dragging, load, save, remove, exportCurrent, importFile } = store
  const fileRef = useRef<HTMLInputElement>(null)
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b))

  return (
    <div className="flex flex-col gap-6 px-4 pb-6">
      <Section title="In this browser">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs"
          value={selected}
          onChange={(e) => load(e.target.value)}
          aria-label="Load a preset"
        >
          <option value="">{names.length ? 'load a preset…' : 'no saved presets'}</option>
          {names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={save} title="Save the current settings as a preset, in this browser">
            <Save /> Save
          </Button>
          <Button variant="outline" size="sm" onClick={remove} disabled={!selected}>
            <Trash2 /> Delete
          </Button>
        </div>
      </Section>
      <Section title="As a file" description="Import keeps the file's settings as a preset. You can also drop a preset file anywhere on the page.">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCurrent} title="Download the current settings as a file">
            <Download /> Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(dragging && 'border-dashed border-highlight text-highlight')}
            onClick={() => fileRef.current?.click()}
            title="Load settings from an exported file, and keep them as a preset"
          >
            <Upload /> {dragging ? 'Drop to import' : 'Import'}
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }}
        />
      </Section>
      <Section title="Current settings" description="This browser remembers them from one visit to the next.">
        <div>
          <Button variant="outline" size="sm" onClick={() => window.confirm('Reset every setting to its default?') && onReset()}>
            <RotateCcw /> Reset to defaults
          </Button>
        </div>
      </Section>
    </div>
  )
}
