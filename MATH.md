# Mathematics of the Force-Directed Graph Visualizer

## Overview

This visualizer uses a **force-directed layout algorithm** to position graph nodes. The core idea: treat the graph as a physical system where nodes repel each other like charged particles, and edges act like springs pulling connected nodes together. The system evolves through discrete time steps until it reaches a low-energy equilibrium state.

---

## 1. Coulomb's Law — Node Repulsion

### Formula

```
F_rep = k_r × q_i × q_j / d²
```

Where:
- **F_rep** = Repulsive force magnitude
- **k_r** = Repulsion constant (default: 5000)
- **q_i, q_j** = "Charge" of each node, proportional to their visual radius: `q = 5 + √(degree + 1) × 3.5`
- **d** = Euclidean distance between nodes: `d = √((x_j - x_i)² + (y_j - y_i)²)`

### Direction

The force vector points **away** from the other node:

```
F⃗_rep = (F_rep × Δx/d, F_rep × Δy/d)
```

Where `Δx = x_j - x_i` and `Δy = y_j - y_i` are the components of the displacement vector.

### Why Inverse Square?

The inverse-square law (`1/d²`) comes from physics — it's how electric charges and gravitational masses interact. This ensures:
- Nodes far apart barely affect each other
- Nodes close together push apart strongly
- The system naturally spreads nodes evenly

### Implementation Note

This uses an **O(n²)** all-pairs approach. For graphs with 500+ nodes, a **Barnes-Hut quadtree** reduces this to **O(n log n)** by approximating distant node clusters as single charges.

---

## 2. Hooke's Law — Spring Attraction

### Formula

```
F_spring = k_s × (d - L₀)
```

Where:
- **F_spring** = Spring force magnitude
- **k_s** = Spring constant (default: 0.1)
- **d** = Current distance between connected nodes
- **L₀** = Rest length of the spring (default: 100px)

### Direction

The force vector points **toward** the connected node:

```
F⃗_spring = (F_spring × Δx/d, F_spring × Δy/d)
```

### Why Linear Spring?

Hooke's law states that the force of a spring is proportional to its displacement from rest length. This creates:
- **Compression** when `d < L₀` → nodes push apart
- **Tension** when `d > L₀` → nodes pull together
- **Zero force** when `d = L₀` → equilibrium

---

## 3. Center Gravity

### Formula

```
F⃗_grav = k_g × (-x, -y)
```

Where:
- **k_g** = Gravity constant (default: 0.01)
- **(-x, -y)** = Vector pointing toward the origin (0, 0)

### Purpose

Without center gravity, the repulsive forces could push the entire graph off-screen. The gravity term acts as a weak anchor, pulling all nodes gently toward the canvas center. This is a **linear spring** to the origin, not inverse-square, so it doesn't interfere with the local force balance.

---

## 4. Mass and Acceleration

### Node Mass

Each node has a mass proportional to its degree:

```
mass = m_base + degree × m_per_deg
```

Default: `mass = 1.0 + degree × 0.4`

### Newton's Second Law

```
a⃗ = F⃗_net / mass
```

Higher-degree nodes have more mass, so they accelerate less. This causes **hub nodes to settle near the center** while leaf nodes orbit around them — matching the natural structure of scale-free networks.

---

## 5. Euler Integration

### Velocity Update

```
v⃗(t+1) = (v⃗(t) + a⃗) × damping
```

### Position Update

```
p⃗(t+1) = p⃗(t) + v⃗(t+1)
```

### Velocity Damping

The damping factor (default: 0.85) removes 15% of velocity each step. This simulates **friction** and ensures the system converges rather than oscillating forever.

### Velocity Clamping

Maximum velocity is capped at 18 units/step to prevent numerical instability when forces are large.

---

## 6. Simulated Annealing

### Alpha Cooling

```
α(t+1) = α(t) × 0.9985
```

The simulation stops when `α < 0.0008`. This exponential cooling schedule:
- Starts hot (α = 1.0) — nodes move freely
- Gradually cools — movements become smaller
- Eventually freezes — system reaches equilibrium

This prevents the system from getting stuck in poor local minima early on, while ensuring convergence.

---

## 7. View Transform

### World-to-Screen

```
screen_x = (world_x + view_x) × zoom + canvas_width/2
screen_y = (world_y + view_y) × zoom + canvas_height/2
```

### Screen-to-World (for interaction)

```
world_x = (screen_x - canvas_width/2) / zoom - view_x
world_y = (screen_y - canvas_height/2) / zoom - view_y
```

This affine transform supports:
- **Panning**: Adjust `view_x`, `view_y`
- **Zooming**: Adjust `zoom` (clamped to [0.08, 6.0])
- **Mouse-wheel zoom**: Zoom toward cursor position by converting screen → world, adjusting zoom, then converting back.

---

## 8. Graph Generation Algorithms

### Barabási–Albert (Scale-Free)

New nodes connect to existing nodes with probability proportional to their degree:

```
P(connect to node i) = (degree_i + 1) / Σ(degree_j + 1)
```

The `+1` ensures new nodes have a chance to connect. This produces **power-law degree distributions** — a few hubs with many connections, many nodes with few connections.

### Erdős–Rényi (Random)

Each possible edge exists independently with probability `p`:

```
P(edge exists) = p
```

Produces graphs with **Poisson degree distributions** — most nodes have similar degrees.

---

## 9. Energy and Convergence

The total system energy is the sum of potential energies:

```
E_total = Σ_repulsion (k_r × q_i × q_j / d) + Σ_springs (½ × k_s × (d - L₀)²)
```

The simulation converges when this energy reaches a local minimum. The alpha value serves as a proxy — when it's near zero, forces are balanced and velocities are negligible.

---

## Summary

| Component | Physics Law | Effect |
|-----------|-------------|--------|
| Repulsion | Coulomb's inverse-square law | Nodes push apart |
| Attraction | Hooke's linear spring | Connected nodes pull together |
| Gravity | Linear central force | Prevents drift off-screen |
| Mass | Newton's F = ma | Hubs move less, settle at center |
| Damping | Friction | System converges to equilibrium |
| Annealing | Simulated cooling | Prevents local minima, ensures convergence |

The result is an aesthetically pleasing layout that reveals the graph's structure: hubs cluster at the center, communities form visible clusters, and the overall arrangement minimizes edge crossings.
