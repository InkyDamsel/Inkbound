import React from 'react';
import './bookDetailsDialogActions.css';

/** One footer/CTA contract for all Book Details companion dialogs. */
export const BookDetailsDialogActions: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`book-details-dialog-actions ${className}`.trim()}>
    {children}
  </div>
);
