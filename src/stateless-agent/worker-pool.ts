// ─── Worker Pool ─────────────────────────────────────────────────────────────
//
// Simulates a pool of stateless workers. Each worker is interchangeable —
// it has no memory of previous conversations. The only state it carries is
// its ID and whether it's alive.
//
// On each turn, a random alive worker is selected. If a worker dies (simulated
// via kill()), the pool transparently routes to another worker. The conversation
// continues with zero context loss because state lives in the external store.

export interface Worker {
  id: string;
  name: string;
  alive: boolean;
  turnsServed: number;
}

export class WorkerPool {
  private workers: Worker[];

  constructor(count: number) {
    this.workers = Array.from({ length: count }, (_, i) => ({
      id: `worker-${i + 1}`,
      name: `Worker ${i + 1}`,
      alive: true,
      turnsServed: 0,
    }));
  }

  // Pick a random alive worker — simulates load balancer with no sticky sessions
  pickRandom(): Worker {
    const alive = this.workers.filter((w) => w.alive);
    if (alive.length === 0) {
      throw new Error("No alive workers in the pool!");
    }
    const picked = alive[Math.floor(Math.random() * alive.length)];
    picked.turnsServed++;
    return picked;
  }

  kill(workerId: string): boolean {
    const worker = this.workers.find((w) => w.id === workerId);
    if (!worker || !worker.alive) return false;
    worker.alive = false;
    return true;
  }

  revive(workerId: string): boolean {
    const worker = this.workers.find((w) => w.id === workerId);
    if (!worker || worker.alive) return false;
    worker.alive = true;
    return true;
  }

  getStatus(): { id: string; name: string; alive: boolean; turnsServed: number }[] {
    return this.workers.map((w) => ({ ...w }));
  }

  aliveCount(): number {
    return this.workers.filter((w) => w.alive).length;
  }
}
