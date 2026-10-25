# Non-reciprocal forces, derived from the data

How the particle geometry could get the chasing and never-settling motion of Particle Life's
asymmetric force matrix without adding asymmetry by hand: forces read off the digits' high-dimensional
neighbourhoods (or their traces over time) instead of off Leiden's groups.

## Why group forces settle

`Particles.advance` (`web/src/viz/particles.ts`) gives each pair one coefficient, `cohesion` within a
group or `separation` between, and pushes both ends equally and oppositely along the line between them.
Forces that are central, equal and opposite come from a potential, so with damping the cloud relaxes to
a minimum. What motion there is that isn't relaxation comes from outside the pair forces: Leiden's
groups changing as the window moves, and the speaker's pull changing with valence.

Chasing needs **non-reciprocal** forces, where the push on i from j isn't the push on j from i. Particle
Life gets them from a random asymmetric matrix of species against species. The ideas below find the
asymmetry in the data instead.

## Ideas

### 1. The directed kNN graph, before UMAP symmetrises it (implemented)

Being a nearest neighbour isn't mutual: j can be among i's k nearest without i being among j's. UMAP
already weighs each one-way edge, `w(j|i) = exp(−(d_ij − ρ_i) / σ_i)`, with ρ_i the distance to i's
nearest neighbour and σ_i a bandwidth fitted to i's local density (`knn.ts`, `smoothKnnDist`). It then
symmetrises them with the fuzzy union `w + wᵀ − w∘wᵀ`, the step that makes the graph undirected for
Leiden. t-SNE does the same with `p(j|i)` before averaging into `p_ij`.

Skipping that step, the pull on i towards j goes by `w(j|i)` and on j towards i by `w(i|j)`. A digit in a
sparse region (an unusual 7) counts a dense core's digits among its neighbours, but they don't count it:
the outlier chases the core, which takes no notice. The asymmetry is structure the embeddings
deliberately discard, not something added.

### 2. Disagreeing preferred distances (asymmetric stress)

Give each pair a preferred distance in the plane rather than a pull or push: the force on i is
`k · (r_ij − d_ij / σ_i)`, on j `k · (r_ij − d_ij / σ_j)`. Each scales the same high-dimensional distance
by its own density, so the two disagree about how far apart they should be: one keeps closing the gap
the other keeps opening, and the pair runs. That frustration is how Particle Life's chasing pairs arise.
With σ_i = σ_j it's metric MDS, and conservative, so asymmetry appears only as far as density varies.

### 3. Leader and follower over time

The digits are time series. Pull i towards j by how well j's recent past predicts i's present: lagged
cross-correlation `corr(v_i(t), v_j(t − τ))` across the trail window, or transfer entropy for something
more rigorous. It's directed by definition: if i echoes j a few pixels later, i follows j and not the
other way round, so chasing in the plane reads as one trace lagging another. With a speaker, it becomes
who comes round to agreeing first.

## Where PaCMAP and UMAP fit

Both are gradient descent on a loss, so as they stand they're conservative and settle. Still useful:

- **PaCMAP's three kinds of pair** (near neighbours attract, mid-near pairs attract weakly, sampled
  further pairs repel) would replace in-or-out-of-group with forces graded by distance, and its phased
  weights give a schedule: global structure first, then local.
- **A target that moves is a legitimate drive.** UMAP or PaCMAP forces taken on the window's distances
  change their landscape as the playhead moves, which keeps putting energy in: honestly out of
  equilibrium, as a driven system is, but drifting and lagging rather than chasing. Combined with 1 or
  3, it would give both.

## Implementation notes

- **Forces** in the Particles section chooses between **groups** (as before) and **neighbours**. With
  neighbours, the coefficient on i towards j is
  `separation + (cohesion − separation) · w(j|i)`: digits that i counts fully as a neighbour get
  `cohesion` (the "neighbours" slider, "within groups" with group forces), digits it doesn't count get
  `separation` ("others", or "between groups"), with the membership strength between. If w were a group
  indicator, this would be the group forces exactly.
- **One-way neighbours** (on by default) uses `w(j|i)` as is. Off, it uses UMAP's fuzzy union, the same weights
  Leiden clusters, so the forces are symmetric again: the control to compare against, to see what the
  asymmetry alone does.
- The weights are taken over what Leiden clusters over: each digit's principal components, or the
  window of its trace, recomputed with each window clustering. With digits grouped by label, it's the
  principal components.
- Neighbours (k) is the grouping's neighbours slider, shared with Leiden.
- Non-reciprocal forces don't conserve momentum, so the cloud as a whole can drift or turn. The boundary
  holds it in, and with a speaker the field recentres on it.

## Next

- A readout of how asymmetric the forces are, `‖W − Wᵀ‖ / ‖W‖`, beside the one-way toggle.
- Idea 3, the leader–follower forces, as a third option for forces.
- Idea 2, preferred distances, which needs a different force law in `advance` rather than a different
  matrix.
