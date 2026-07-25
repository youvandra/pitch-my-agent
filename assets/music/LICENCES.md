# Track licences and measured tempo

All tracks below are from Pixabay, under the [Pixabay Content
License](https://pixabay.com/service/license-summary/): commercial use is
permitted and attribution is not required. They are used as a bed under
generated video, not redistributed on their own.

## In use

| File | Source title | BPM | How the tempo was established |
|---|---|---|---|
| `saas-120-product-demo.mp3` | momotmusic — A Product Demo (167264) | 120 | autocorrelation 121, beat-grid 120 (score 10.4, margin 1.45) |
| `saas-120-presentation.mp3` | gr0za — Product Presentation (503370) | 120 | autocorrelation 121, beat-grid 120 (score 7.8, margin 1.18) |
| `saas-118-technology.mp3` | paulyudin — Presentation Technology (159846) | 118 | autocorrelation 117, beat-grid 118 (score 9.3, margin 1.91) |
| `terminal-117-business.mp3` | momotmusic — Business (168341) | 117 | autocorrelation 117, beat-grid 117 (score 10.0, margin 1.46) |
| `playful-103-coffee.mp3` | momotmusic — Coffee Time (393723) | 103 | autocorrelation 104, beat-grid 103 (score 8.8, margin 1.82) |

## Held back

These keep their original filenames, so the loader skips them. Two independent
methods disagreed on their tempo, and the candidates are not simple multiples of
each other — a 2:3 error drifts a little further out of time on every cut, which
is worse than not using the track at all.

| File | Autocorrelation | Beat-grid | Note |
|---|---|---|---|
| `53976329-startup-pitch-background-modern-clean-459162.mp3` | 160 | 75 | unrelated candidates, weak peaks |
| `the_mountain-investor-pitch-132404.mp3` | 134 | 75 | unrelated candidates, weak peaks |
| `alanajordan-sparkle-233419.mp3` | 139 | 92 | 2:3 ambiguity, margin 1.04 |

To bring one back: confirm its real tempo (tap it out against a metronome, or
read it off the source page) and rename it to `<style>-<bpm>-<label>.mp3`.
