import { useEffect, useRef, useState } from 'react'
import { exportPreset, importPreset, loadPresets, storePresets, type Presets as PresetMap, type Settings } from '../presets'

/** Save the page's settings under a name and load them back, or carry them between browsers as files. */
export function Presets({ settings, onLoad }: { settings: Settings; onLoad: (settings: Settings) => void }) {
  const [presets, setPresets] = useState<PresetMap>(loadPresets)
  const [selected, setSelected] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const update = (next: PresetMap) => {
    setPresets(next)
    storePresets(next)
  }
  const load = (name: string) => {
    setSelected(name)
    if (presets[name]) onLoad(presets[name])
  }
  const save = () => {
    const name = window.prompt('Save these settings as', selected || 'my preset')?.trim()
    if (!name) return
    if (name !== selected && presets[name] && !window.confirm(`Replace the preset “${name}”?`)) return
    update({ ...presets, [name]: settings })
    setSelected(name)
  }
  const remove = () => {
    if (!window.confirm(`Delete the preset “${selected}”?`)) return
    const { [selected]: _, ...rest } = presets
    update(rest)
    setSelected('')
  }
  // A preset file dropped anywhere on the page imports it (rather than the browser opening it).
  const importRef = useRef<(file: File) => void>(undefined)
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragging(true)
    }
    // Leaving the window has no element to go to.
    const onLeave = (e: DragEvent) => void (e.relatedTarget === null && setDragging(false))
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setDragging(false)
      const file = e.dataTransfer!.files[0]
      if (file) importRef.current?.(file)
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  const importFile = async (file: File) => {
    try {
      const { name, settings: imported } = await importPreset(file)
      update({ ...presets, [name]: imported })
      setSelected(name)
      onLoad(imported)
    } catch {
      window.alert(`Couldn't read a preset from ${file.name}.`)
    }
  }
  useEffect(() => {
    importRef.current = (file) => void importFile(file)
  })

  return (
    <div className="toolbar">
      <span className="control-label">Presets</span>
      <select value={selected} onChange={(e) => load(e.target.value)} aria-label="Load a preset">
        <option value="">{Object.keys(presets).length ? 'load a preset…' : 'no saved presets'}</option>
        {Object.keys(presets)
          .sort((a, b) => a.localeCompare(b))
          .map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
      </select>
      <span className={`muted drop-hint${dragging ? ' drop-target' : ''}`}>{dragging ? 'drop to load it' : 'or drop a preset file anywhere'}</span>
      <button onClick={save} title="Save the current settings as a preset, in this browser">
        Save
      </button>
      <button onClick={remove} disabled={!selected}>
        Delete
      </button>
      <button onClick={() => exportPreset(selected || 'settings', settings)} title="Download the current settings as a file">
        Export
      </button>
      <button
        className={dragging ? 'drop-target' : ''}
        onClick={() => fileRef.current?.click()}
        title="Load settings from an exported file (or drop one anywhere on the page), and keep them as a preset"
      >
        {dragging ? 'Drop to import' : 'Import'}
      </button>
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
    </div>
  )
}
