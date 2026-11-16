export function AlerdLogo({ size = 44, className = "" }: { size?: number; className?: string }) {
  // The supplied mascot is a static, transparent local asset.
  return <img src="/alerd-logo.png" alt="" width={size} height={size} className={`shrink-0 object-contain ${className}`} />;
}
