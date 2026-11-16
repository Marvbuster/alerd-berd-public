import { Icon, type IconName } from "./Icon";

export function PageHeader({ title, description, icon = "layers", actions }: {
  title: string; description: string; icon?: IconName; actions?: React.ReactNode;
}) {
  return <header className="page-header">
    <div className="page-heading"><span className="page-icon"><Icon name={icon} size={28} /></span><div><h1>{title}</h1><p>{description}</p></div></div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}
