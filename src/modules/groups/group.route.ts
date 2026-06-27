import { Router } from 'express';
import {
  getGroupById,
  getGroupMembers,
  getGroups,
  getSummary,
  postGroup,
  postGroupMember,
} from './group.controller.js';
import { expenseRouter } from '../expenses/expense.route.js';

export const groupRouter = Router();

groupRouter.get('/', getGroups);
groupRouter.post('/', postGroup);
groupRouter.use('/:groupId/expenses', expenseRouter);
groupRouter.get('/:groupId/members', getGroupMembers);
groupRouter.get('/:groupId', getGroupById);
groupRouter.post('/:groupId/members', postGroupMember);
groupRouter.get('/:groupId/summary', getSummary);
