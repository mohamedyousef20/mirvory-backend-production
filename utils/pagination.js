/**
 * Shared pagination helpers.
 *
 * MongoDB does not guarantee an order for documents that compare equal under
 * the requested sort, so `skip`/`limit` over a non-unique sort key (createdAt,
 * price, sold, …) can return the same document on two different pages and drop
 * others entirely. Appending the unique `_id` makes the order total, which is
 * what makes page N and page N+1 disjoint.
 */

export const withStableTiebreaker = (sortObj) => {
  if (!sortObj || typeof sortObj !== 'object' || Array.isArray(sortObj)) {
    return { createdAt: -1, _id: -1 };
  }

  const keys = Object.keys(sortObj);
  if (keys.length === 0) return { createdAt: -1, _id: -1 };
  if (keys.includes('_id')) return { ...sortObj };

  return { ...sortObj, _id: -1 };
};

export const MAX_PAGE_LIMIT = 100;

/**
 * Normalises `page`/`limit` query params into safe integers.
 */
export const parsePageParams = (query = {}, defaultLimit = 12) => {
  const parsedPage = parseInt(query.page, 10);
  const parsedLimit = parseInt(query.limit, 10);

  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, MAX_PAGE_LIMIT)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Pagination metadata shared by every paginated endpoint.
 */
export const buildPaginationMeta = ({ page, limit }, total) => {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  return {
    page,
    currentPage: page,
    limit,
    itemsPerPage: limit,
    total,
    totalItems: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
  };
};
