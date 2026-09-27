# hopper

<!-- One paragraph: what this is, and the shape of it. Replace this line. -->

## Its own rules

This project owns its architecture, stack, deployment, and naming. It is symlinked into the
`sb-meta` orchestration repo for convenience, which implies nothing about sharing anything with
the projects sitting next to it. Do not carry a pattern into this repo from another one merely
because it was nearby.

The one exception: if this project is TypeScript, the shared toolchain conventions in
`../proj_sb-meta/conventions/toolchain/` apply. Copy those lint, format, and test configs rather
than forking them; `just adopt-toolchain hopper` does it. Nothing else in that repo governs this
one.

Plans live in `../proj_sb-meta/planning/hopper/`.
