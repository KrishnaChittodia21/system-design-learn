import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'mesh-sidecars',
  title: 'Inside the mesh: sidecars, mTLS, retries, canaries and the control plane',
  blurb: 'Service A calls three pods of service B through Envoy sidecars while istiod pushes config and certificates. Run the mTLS handshake, a retry storm, a 90/10 canary, outlier ejection, or take the control plane down.',
  placements: [{ topic: 'net-service-mesh', heading: 'Control plane vs data plane' }],
};
