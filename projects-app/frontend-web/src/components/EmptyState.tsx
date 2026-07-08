import { FC } from 'react';

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

export const EmptyState: FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <div className="card">
      <div className="text-center py-12">
        <Icon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600 mb-4">{description}</p>
        <button onClick={onAction} className="btn btn-primary inline-flex items-center gap-2">
          <Icon className="w-4 h-4" />
          {actionLabel}
        </button>
      </div>
    </div>
  );
};
