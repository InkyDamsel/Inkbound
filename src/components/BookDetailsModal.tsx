import React from 'react';
import { BookDetailsModal as BookDetailsModalCore } from './BookDetailsModalCore';
import { CatalogContributionLauncher } from './catalog/CatalogContributionLauncher';

export const BookDetailsModal: React.FC<React.ComponentProps<typeof BookDetailsModalCore>> = (props) => (
  <>
    <BookDetailsModalCore {...props} />
    {props.book && <CatalogContributionLauncher book={props.book} />}
  </>
);
