import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'k8s-pod-lifecycle',
  title: 'Kubernetes pods: lifecycle, probes, restarts and autoscaling',
  blurb:
    'Step a pod through Pending → ContainerCreating → Running → Ready, then break it: a liveness failure into CrashLoopBackOff (10s, 20s, 40s… capped at 5 min) or an OOMKill. Finally scale up with the HPA formula until pods go Pending and the Cluster Autoscaler adds a node.',
  placements: [
    { topic: 'deployment-infra', heading: '13. Kubernetes under the hood' },
    { topic: 'deployment-infra', heading: '14. Kubernetes scaling strategies' },
    { topic: 'deployment-infra', heading: '6. Horizontal Pod Autoscaler' },
  ],
};
