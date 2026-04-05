# Force-Directed Graph Visualizer

An interactive force-directed graph layout engine built with vanilla HTML, CSS, and JavaScript. No dependencies — just open `index.html` in a browser.

## Features

- **Force-directed physics simulation** — Coulomb repulsion, Hooke spring attraction, center gravity, velocity damping
- **Multiple graph generators** — Barabási–Albert (scale-free), Erdős–Rényi (random), clusters, grid, stars, binary tree
- **Interactive controls** — Pan, zoom, drag nodes, click-to-center, pin/unpin
- **Real-time stats** — Node/edge count, density, max degree, simulation energy
- **Adjustable physics** — Sliders for repulsion, spring length/strength, gravity, damping
- **Degree-based coloring** — Nodes colored by connection count with glow effects

## Quick Start

```
Open index.html in any modern browser.
```

## Project Structure

```
graph-visualizer/
├── index.html    # Main HTML structure
├── styles.css    # All styles
├── script.js     # Physics engine + rendering + interaction
├── MATH.md       # Detailed math explanation of the force model
└── README.md     # This file
```

## The Math

See [MATH.md](MATH.md) for a complete breakdown of the physics model, including:
- Coulomb's law for node repulsion
- Hooke's law for spring attraction
- Euler integration with damping
- Simulated annealing cooling schedule
- View transform mathematics
- Graph generation algorithms

## Controls

| Action | Effect |
|--------|--------|
| Scroll | Zoom in/out |
| Drag canvas | Pan view |
| Drag node | Move node (pins temporarily) |
| Click node | Smooth pan to center node |
| Double-click node | Pin/unpin node |
| Play/Pause button | Toggle simulation |
| Fit view | Zoom to fit all nodes |
| Reset view | Center on hub node |
