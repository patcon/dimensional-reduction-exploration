# Pixel shuffle controls on the digit preview

Status: idea, not started.

Today the pixel shuffle buttons (Rows, Columns, All pixels) sit in the page header, with a help line
under them. This proposal moves them onto the digit preview in the sidebar, so each control sits on the
edge it acts on and shows the shuffle it applies.

## Layout

```
        ┌──────────────────┐
   ⤨    │▁▂▃▄▅▆▇█  columns │  ← top ruler: click to shuffle columns
        └──────────────────┘
 ┌──┐   ┌──────────────────┐
 │▁ │   │                  │
 │▂ │   │      digit       │
 │▃ │   │     preview      │
 │▄ │   │                  │
 │… │   │                  │
 └──┘   └──────────────────┘
  ↑ left ruler: click to shuffle rows
```

- **Rulers.** A thin strip along the top and another down the left side. Each is a smooth gradient
  (light to dark, or a hue ramp) with one stripe per pixel column or row. Clicking a ruler toggles that
  shuffle. When it's on, the stripes are drawn in the shuffled order (from `pixelOrderFor`), so the
  ruler scrambles exactly as the digit does: it's a key to the shuffle as well as a control.
- **All-pixels button.** A small ⤨ in the top-left corner, where the rulers meet, since it acts on both
  axes at once. When it's on, both rulers fade out: a full shuffle has no row or column structure left
  to show. That also shows that All pixels overrides the other two, rather than relying on a note.
- **Tooltips.** Hovering a ruler or the corner shows a short tooltip, like "Shuffle rows (same for
  every digit)". The long help line in the header can shrink to one sentence.
- **Empty state.** The controls need to make sense before any digit is hovered, so the preview shows a
  stand-in. The average digit works: it's recognisable, and shuffling it shows clearly what moved.
- **Resolution.** The rulers redraw for the current resolution (32 stripes at 32×32, 4 at 4×4) and
  line up with the preview's existing grid overlay.

## Open questions

- **Do the header buttons go?** The shuffle affects every view, so the sidebar is a reasonable home,
  but it's less obvious there that it's page-wide. Probably keep a one-line "Pixel shuffling: rows,
  columns" status in the header, linked to the preview.
- **Space.** The rulers add about 12px to the left and top of the preview. That should fit in the
  320px sidebar, but check it alongside the label/cluster details.

## Rollout

1. Add the rulers and the corner button, keeping the header buttons alongside so both can be compared.
2. Once the rulers feel right, replace the header buttons with the one-line status.

## Alternatives considered

- **"Shuffle on/off" plus "lock X" / "lock Y" toggles.** Loses the rows + columns mode (both axes
  permuted, grid intact), leaves a dead "lock both" combination, and "lock X" reads as scrambling each
  column independently, which breaks the grid that the Rows/Columns modes keep.
- **One choice: Off | Rows | Columns | Rows + columns | All pixels.** A smaller fix if the current
  buttons only feel awkward; removes the rule that All pixels clears the other two.
