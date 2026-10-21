/**
 * ProjectPilot AI - Sample Demonstration Dataset
 * Clearly identified as sample data inspired by common developer scenarios.
 */

export function getSampleData() {
  const now = new Date();
  const pastDays = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
  const futureDays = (d) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000).toISOString();

  return {
    meta: {
      version: '1.0.0',
      description: 'ProjectPilot AI Demonstration Dataset (Sample Data)',
      seededAt: now.toISOString()
    },
    projects: [
      {
        id: 'proj-cloudsync',
        name: 'CloudSync Gateway',
        description: 'High-throughput file synchronization service connecting on-premise storage to multi-region cloud buckets.',
        category: 'Fullstack',
        techStack: ['Node.js', 'TypeScript', 'AWS S3', 'Docker'],
        repoUrl: 'https://github.com/example/cloudsync-gateway',
        status: 'active',
        priority: 'high',
        createdAt: pastDays(30),
        updatedAt: pastDays(1)
      },
      {
        id: 'proj-devpulse',
        name: 'DevPulse Analytics',
        description: 'Developer productivity and DORA metrics aggregation backend processing telemetry from Git repositories.',
        category: 'Backend',
        techStack: ['Go', 'PostgreSQL', 'Redis', 'Kubernetes'],
        repoUrl: 'https://github.com/example/devpulse-analytics',
        status: 'active',
        priority: 'critical',
        createdAt: pastDays(45),
        updatedAt: pastDays(2)
      },
      {
        id: 'proj-checkout',
        name: 'Mobile Checkout SDK',
        description: 'Cross-platform mobile payment and checkout module with one-tap payment integrations.',
        category: 'Mobile',
        techStack: ['Swift', 'Kotlin', 'GraphQL', 'Stripe'],
        repoUrl: 'https://github.com/example/mobile-checkout-sdk',
        status: 'active',
        priority: 'critical',
        createdAt: pastDays(20),
        updatedAt: pastDays(1)
      },
      {
        id: 'proj-edgecache',
        name: 'Edge Cache Daemon',
        description: 'High-performance reverse proxy and dynamic caching daemon deployed on edge PoP instances.',
        category: 'DevOps',
        techStack: ['Rust', 'Linux', 'eBPF', 'Tokio'],
        repoUrl: 'https://github.com/example/edge-cache-daemon',
        status: 'planning',
        priority: 'medium',
        createdAt: pastDays(10),
        updatedAt: pastDays(3)
      }
    ],
    tasks: [
      {
        id: 'task-cloudsync-1',
        projectId: 'proj-cloudsync',
        title: 'Implement multipart upload resume for files > 5GB',
        description: 'Add etag checkpointing to allow interrupted S3 uploads to resume without full retransmission.',
        status: 'in_progress',
        priority: 'high',
        dueDate: futureDays(2),
        blocker: null,
        isMaintenance: false,
        isBug: false,
        createdAt: pastDays(7),
        updatedAt: pastDays(1),
        completedAt: null
      },
      {
        id: 'task-cloudsync-cert',
        projectId: 'proj-cloudsync',
        title: 'Rotate SSL certs and renew AWS IAM session keys',
        description: 'Quarterly rotation of TLS certificates and renewal of staging IAM credentials.',
        status: 'todo',
        priority: 'high',
        dueDate: futureDays(3),
        blocker: null,
        isMaintenance: true,
        isBug: false,
        createdAt: pastDays(5),
        updatedAt: pastDays(5),
        completedAt: null
      },
      {
        id: 'task-devpulse-leak',
        projectId: 'proj-devpulse',
        title: 'Resolve memory spike during hourly rollup aggregation',
        description: 'Hourly rollup worker allocates unbounded Redis buffer during high-event volume bursts.',
        status: 'in_progress',
        priority: 'critical',
        dueDate: futureDays(1),
        blocker: null,
        isMaintenance: false,
        isBug: true,
        createdAt: pastDays(4),
        updatedAt: pastDays(1),
        completedAt: null
      },
      {
        id: 'task-devpulse-db',
        projectId: 'proj-devpulse',
        title: 'Run PostgreSQL vacuum analyze and re-index rollup tables',
        description: 'Routine maintenance to reclaim space on time-series partitions.',
        status: 'todo',
        priority: 'medium',
        dueDate: pastDays(1), // Overdue maintenance
        blocker: null,
        isMaintenance: true,
        isBug: false,
        createdAt: pastDays(14),
        updatedAt: pastDays(2),
        completedAt: null
      },
      {
        id: 'task-checkout-oauth',
        projectId: 'proj-checkout',
        title: 'Fix token refresh race condition in background mode',
        description: 'Simultaneous API calls in background refresh trigger invalid grant error from upstream auth.',
        status: 'blocked',
        priority: 'critical',
        dueDate: futureDays(1),
        blocker: 'Upstream identity service v2 rejects concurrent token refresh calls with HTTP 429.',
        isMaintenance: false,
        isBug: true,
        createdAt: pastDays(3),
        updatedAt: pastDays(1),
        completedAt: null
      },
      {
        id: 'task-checkout-applepay',
        projectId: 'proj-checkout',
        title: 'Integrate Apple Pay PKPaymentAuthorizationController',
        description: 'Add biometric payment flow callback handlers and error mapping.',
        status: 'todo',
        priority: 'high',
        dueDate: futureDays(5),
        blocker: null,
        isMaintenance: false,
        isBug: false,
        createdAt: pastDays(6),
        updatedAt: pastDays(6),
        completedAt: null
      },
      {
        id: 'task-edgecache-ebpf',
        projectId: 'proj-edgecache',
        title: 'Draft eBPF XDP socket packet filter prototype',
        description: 'Initial performance bench for filtering TCP SYN packets at the network card driver level.',
        status: 'todo',
        priority: 'medium',
        dueDate: futureDays(14),
        blocker: null,
        isMaintenance: false,
        isBug: false,
        createdAt: pastDays(5),
        updatedAt: pastDays(5),
        completedAt: null
      },
      {
        id: 'task-cloudsync-init',
        projectId: 'proj-cloudsync',
        title: 'Setup repository CI pipeline and container definitions',
        description: 'Configured GitHub Actions for linting, testing, and multi-arch Docker image build.',
        status: 'done',
        priority: 'medium',
        dueDate: pastDays(10),
        blocker: null,
        isMaintenance: false,
        isBug: false,
        createdAt: pastDays(25),
        updatedAt: pastDays(15),
        completedAt: pastDays(15)
      }
    ]
  };
}
