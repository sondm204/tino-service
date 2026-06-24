import type { Request } from 'express';

export type PageableRequest = {
  page: number;
  size: number;
};

export type PageableResponse<T> = {
  items: T[];
  page: number;
  size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
};

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;
const MAX_SIZE = 100;

export function getPageable(req: Request): PageableRequest {
  const page = Number(req.query.page);
  const size = Number(req.query.size);

  return {
    page: Number.isInteger(page) && page > 0 ? page : DEFAULT_PAGE,
    size:
      Number.isInteger(size) && size > 0
        ? Math.min(size, MAX_SIZE)
        : DEFAULT_SIZE,
  };
}

export function toPageableResponse<T>(
  items: T[],
  pageable: PageableRequest,
  total: number
): PageableResponse<T> {
  const totalPages = Math.ceil(total / pageable.size);

  return {
    items,
    page: pageable.page,
    size: pageable.size,
    total,
    total_pages: totalPages,
    has_next: pageable.page < totalPages,
    has_previous: pageable.page > 1,
  };
}

export function toSupabaseRange(pageable: PageableRequest) {
  const from = (pageable.page - 1) * pageable.size;
  const to = from + pageable.size - 1;

  return { from, to };
}
