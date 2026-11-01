# Contributing to Physio Atlas

Thanks for helping. Physio Atlas is a study tool for physiotherapy students and clinicians, so two things matter most:
the anatomy has to be right, and the app has to stay fast and easy to use. Contributions of any size are welcome,
from fixing a typo in an insertion to adding a new joint.

## Ways to help

- **Fix or improve clinical content.** Origins, insertions, innervation, actions, notes and common conditions live in
  `app/lib/data/`. This is the most valuable kind of contribution, and you do not need to know Three.js to make it.
- **Report a problem.** Open an issue with what you saw, what you expected, and steps or a screenshot. For anatomy
  errors, include a reference (see below).
- **Improve the viewer, rig or UI.** Bugs in movement, selection, layout, mobile or accessibility.
- **Improve the docs.** If something in the README was unclear when you set up the project, fix it.

If you plan a large change (a new joint, a new view, a change to the model pipeline), open an issue first so we can
agree on the approach before you spend time on it.

## Getting set up

You need Node.js 20 or newer.

```bash
git clone <your fork>
cd physio-atlas
npm install
npm run dev        # http://localhost:3000
```

The converted models are already in `public/models`, so you do not need to download BodyParts3D unless you are changing
`scripts/build-models.mjs`. The README explains how to rebuild them.

## Project layout

| Path | What is there |
| --- | --- |
| `app/components/` | React components for the viewer, panels, cards and lessons |
| `app/lib/data/` | Clinical text (`muscles-*.ts`), movement table (`actions.ts`), learning content (`learning.ts`) |
| `app/lib/rig/` | Skeleton, joint pivots, degrees of freedom and range-of-motion limits, skinning |
| `app/lib/three/` | Three.js scene, loading and rendering |
| `scripts/` | Model build pipeline and the check scripts |
| `public/models/` | Converted, Draco-compressed GLB models (CC BY-SA, see below) |

## Editing clinical content

Muscles are keyed by a kebab-case id (for example `latissimus-dorsi`) that matches the model. Each entry in
`muscles-upper.ts`, `muscles-lower.ts` or `muscles-trunk.ts` has `origin`, `insertion`, `innervation`, `action` and an
optional `note`.

The movement table in `actions.ts` maps `<joint>.<dof>.<pos|neg>` to prime movers, assistants and stabilizers. It is
the source of truth for a muscle's role in a movement. Use `muscle/part` for one part of a multi-part muscle (for
example `deltoid/acromial-part`). The comment at the top of the file explains the side prefixes used for spinal
movements.

When you change clinical content:

- **Cite a source** in the pull request description: a standard text such as Gray's Anatomy, Kendall's *Muscles:
  Testing and Function*, Neumann's *Kinesiology of the Musculoskeletal System*, Moore's *Clinically Oriented Anatomy*,
  or a peer-reviewed paper. Give the edition and page or section if you can.
- **Write the way the existing entries do:** short, plain, consistent terms. Spell out abbreviations the first time
  unless they are standard (MCP, PIP, DIP, CN).
- **Where sources disagree** (nerve roots are a common case), use the most widely taught version and mention the
  difference in the pull request.
- The content is an educational summary and has not been clinically reviewed. Do not add treatment advice or dosing.

## Code style

- TypeScript throughout. Keep it strictly typed; avoid `any`.
- Match the formatting of the file you are editing (2-space indent, single quotes, semicolons).
- Keep components focused, and keep data out of components: anatomy belongs in `app/lib/data/`.
- Performance matters on phones. Avoid per-frame allocations in render loops, and check that the mobile layout still
  works.
- Do not add dependencies without a good reason. Say why in the pull request.

## Before you open a pull request

Run the checks and make sure they pass:

```bash
npm run typecheck             # TypeScript
npm run check                 # validates the converted models
npx tsx scripts/check-rig.ts  # joint directions, data keys, no unknown muscles
npm run build                 # production build
```

`check-rig.ts` catches most data mistakes, such as a muscle key in `actions.ts` that does not exist. If you changed
anything visible, open the app and try it, including at phone width, and add a before/after screenshot to the pull
request.

## Pull requests

1. Fork the repository and create a branch from `main` with a descriptive name, for example
   `fix/supraspinatus-insertion` or `feat/ankle-presets`.
2. Keep each pull request to one change. Small pull requests get reviewed faster.
3. Write commit messages in the imperative: "Fix tibialis anterior innervation", not "fixed stuff".
4. In the description, say what changed and why, how you tested it, and your sources for any clinical content.

## Licensing of contributions

The application code is under the [MIT License](LICENSE). The 3D models in `public/models` are adapted from
[BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html) and are under
[CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/).

By submitting a contribution you agree that code and text are licensed under MIT, and that changes to the models are
licensed under CC BY-SA 2.1 Japan. Only contribute work you have the right to share. Do not paste text or images from
copyrighted textbooks; write the content in your own words and cite the source.

## Conduct

Be kind and constructive. Assume good faith, critique the work rather than the person, and remember that many
contributors are students. Harassment or personal attacks are not tolerated, and maintainers may remove comments or
block contributors who engage in them.
