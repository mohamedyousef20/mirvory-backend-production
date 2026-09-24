/**
 * Global Sort Middleware
 * Handles sorting parameters and adds sort object to request
 * Supports multiple sort fields and directions
 */

import { withStableTiebreaker } from '../utils/pagination.js';

export const sort = (defaultSort = { createdAt: -1 }) => {
  return (req, res, next) => {
    try {
      const sortParam = req.query.sort;
      let sortObj = { ...defaultSort };

      if (sortParam) {
        // Parse sort parameter (format: field:direction,field:direction)
        const sortFields = sortParam.split(',');

        sortObj = {};
        sortFields.forEach((field) => {
          const [fieldName, direction] = field.split(':');
          if (!fieldName) return;
          const sortDirection = direction === 'asc' ? 1 : -1;
          sortObj[fieldName] = sortDirection;
        });
      }

      // Add sort object to request
      req.sort = withStableTiebreaker(sortObj);

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Common sort configurations
 */
export const commonSortOptions = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  priceHigh: { price: -1 },
  priceLow: { price: 1 },
  nameAsc: { title: 1 },
  nameDesc: { title: -1 },
  rating: { 'ratings.average': -1 },
  popular: { sold: -1 },
};

/**
 * Helper to get sort object from string
 */
export const getSortFromString = (sortString) => {
  if (!sortString) return withStableTiebreaker({ createdAt: -1 });
  if (commonSortOptions[sortString]) return withStableTiebreaker(commonSortOptions[sortString]);

  // Parse custom sort format
  const [field, direction] = sortString.split(':');
  if (!field) return withStableTiebreaker({ createdAt: -1 });
  return withStableTiebreaker({ [field]: direction === 'asc' ? 1 : -1 });
};
