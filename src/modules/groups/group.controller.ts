import type { Request, Response } from 'express';
import { isAppError } from '../../common/app-error.js';
import { sendError, sendSuccess } from '../../common/api-response.js';
import { getAuthenticatedUserId } from '../../common/auth.middleware.js';
import { getPageable } from '../../common/pageable.js';
import { getRequiredParam } from '../../common/request.js';
import {
  addGroupMember,
  createGroup,
  getGroup,
  getGroupSummary,
  listGroupMembers,
  listGroups,
  requireGroupMember,
} from './group.service.js';

export async function getGroups(req: Request, res: Response) {
  try {
    const userId = getAuthenticatedUserId(req);
    const data = await listGroups(getPageable(req), userId);

    return sendSuccess(res, 200, 'GROUP_LISTED', 'Groups fetched successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function postGroup(req: Request, res: Response) {
  try {
    const data = await createGroup(req.body, getAuthenticatedUserId(req));

    return sendSuccess(res, 201, 'GROUP_CREATED', 'Group created successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function getGroupById(req: Request, res: Response) {
  try {
    const groupId = getRequiredParam(req.params, 'groupId');
    await requireGroupMember(groupId, getAuthenticatedUserId(req));
    const data = await getGroup(groupId);

    return sendSuccess(res, 200, 'GROUP_FETCHED', 'Group fetched successfully', data);
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function postGroupMember(req: Request, res: Response) {
  try {
    const groupId = getRequiredParam(req.params, 'groupId');
    const data = await addGroupMember(
      groupId,
      req.body,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      201,
      'GROUP_MEMBER_CREATED',
      'Group member created successfully',
      data
    );
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function getGroupMembers(req: Request, res: Response) {
  try {
    const groupId = getRequiredParam(req.params, 'groupId');
    const data = await listGroupMembers(
      groupId,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      200,
      'GROUP_MEMBER_LISTED',
      'Group members fetched successfully',
      data
    );
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}

export async function getSummary(req: Request, res: Response) {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const groupId = getRequiredParam(req.params, 'groupId');
    const data = await getGroupSummary(
      groupId,
      month,
      getAuthenticatedUserId(req)
    );

    return sendSuccess(
      res,
      200,
      'GROUP_SUMMARY_FETCHED',
      'Group summary fetched successfully',
      data
    );
  } catch (error) {
    if (isAppError(error)) {
      return sendError(res, error.status, error.code, error.message);
    }

    return sendError(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
  }
}
