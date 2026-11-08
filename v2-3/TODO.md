# TODO

- [ ] Neighbour boost as a 0–1 slider, fading PaCMAP's neighbour kernel into LocalMAP's, in place of the switch.
- [ ] Mark resamples on the schedule graph.
- [ ] A threshold relative to the layout's spread, if the absolute one (LocalMAP's) proves fiddly once forces grow
      the layout.
- [ ] Redraw far pairs in a worker, as at 65k digits a redraw takes 0.2–0.5 s on a laptop, holding up the steps.
