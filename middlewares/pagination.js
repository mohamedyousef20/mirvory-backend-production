/**
 * Global Pagination Middleware
 * Handles pagination parameters and adds pagination metadata to request
 * Default limit: 12 items per page
 */

import { buildPaginationMeta, parsePageParams } from '../utils/pagination.js';

export const paginate = (defaultLimit = 12) => {
  return (req, res, next) => {
    try {
      req.pagination = parsePageParams(req.query, defaultLimit);

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Helper function to format pagination response
 */
export const formatPaginationResponse = (data, total, pagination) => ({
  success: true,
  data,
  pagination: buildPaginationMeta(pagination, total),
});
