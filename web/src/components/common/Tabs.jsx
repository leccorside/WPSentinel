import React from 'react';

export function Tabs({ tabs = [], activeTab, onChange }) {
  return (
    <div className="flex items-center gap-1 border-b border-outline-variant/30 overflow-x-auto pb-px">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-headline font-semibold transition-colors border-b-2 whitespace-nowrap ${
              isActive
                ? 'border-primary text-primary bg-surface-container-high/40'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50'
            }`}
          >
            {tab.icon && <span className="material-symbols-outlined text-base">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
                  isActive ? 'bg-primary/20 text-primary' : 'bg-surface-container-high text-outline'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
