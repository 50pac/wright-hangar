/** Static stand-in for the 3D model (load failure / timeout): flat, warm-lit Baymax silhouette drawn in SVG. No motion. */
export default function Placeholder() {
  return <svg className="vz-placeholder" data-stage-placeholder viewBox="0 0 200 300" role="img" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="ph-body" cx="50%" cy="38%" r="70%"><stop offset="0" stopColor="#f6efe2"/><stop offset=".55" stopColor="#c9c0b2"/><stop offset="1" stopColor="#4a4e5c"/></radialGradient>
      <radialGradient id="ph-chip" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#ffe2a8"/><stop offset="1" stopColor="#f4c88e" stopOpacity="0"/></radialGradient>
    </defs>
    <ellipse cx="100" cy="292" rx="52" ry="5" fill="#000" opacity=".35"/>
    <ellipse cx="100" cy="196" rx="62" ry="86" fill="url(#ph-body)"/>
    <ellipse cx="38" cy="168" rx="16" ry="44" fill="url(#ph-body)" transform="rotate(14 38 168)"/>
    <ellipse cx="162" cy="168" rx="16" ry="44" fill="url(#ph-body)" transform="rotate(-14 162 168)"/>
    <ellipse cx="100" cy="86" rx="38" ry="30" fill="url(#ph-body)"/>
    <circle cx="86" cy="86" r="4" fill="#0d0d11"/><circle cx="114" cy="86" r="4" fill="#0d0d11"/><rect x="86" y="85.2" width="28" height="1.6" fill="#0d0d11"/>
    <circle cx="100" cy="176" r="26" fill="url(#ph-chip)"/>
  </svg>;
}
