/** Named presets of the settings, kept in the browser, and imported from files dropped anywhere on the page. */

import { useEffect, useRef, useState } from 'react'
import { exportPreset, importPreset, loadPresets, storePresets, type Presets, type Settings } from './presets'

/**
 * The saved presets and the one chosen, with ways to load, save, delete, export and import them. It lives with the page
 * rather than with the presets' sheet, so a preset file dropped anywhere imports it whether or not the sheet is open.
 */
export function usePresets(settings: Settings, onLoad: (settings: Settings) => void) {
  const [presets, setPresets] = useState<Presets>(loadPresets)
  const [selected, setSelected] = useState('')
  const [dragging, setDragging] = useState(false)

  const update = (next: Presets) => {
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
  const exportCurrent = () => exportPreset(selected || 'settings', settings)
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

  // A preset file dropped anywhere on the page imports it (rather than the browser opening it).
  const importRef = useRef<(file: File) => void>(undefined)
  useEffect(() => {
    importRef.current = (file) => void importFile(file)
  })
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

  return { presets, selected, dragging, load, save, remove, exportCurrent, importFile }
}

export type PresetStore = ReturnType<typeof usePresets>
