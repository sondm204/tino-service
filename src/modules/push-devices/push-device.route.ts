import { Router } from 'express';
import { deletePushDevice, putPushDevice } from './push-device.controller.js';

export const pushDeviceRouter = Router();

pushDeviceRouter.put('/', putPushDevice);
pushDeviceRouter.delete('/:deviceId', deletePushDevice);
