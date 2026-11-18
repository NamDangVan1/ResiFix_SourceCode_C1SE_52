import { Router } from 'express';
import authRoutes from './auth.routes';
import ticketRoutes from './ticket.routes';
import notificationRoutes from './notification.routes';
import uploadRoutes from './upload.routes';
import managementRoutes from './management.routes';
import payrollRoutes from './payroll.routes';
import scheduleRoutes from './schedule.routes';
import costRoutes from './cost.routes';
import slaRoutes from './sla.routes';

const apiRouter = Router();

// Gắn kết 9 phân hệ API chính thức của ResiFix
apiRouter.use('/auth', authRoutes);
apiRouter.use('/tickets', ticketRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/upload', uploadRoutes);
apiRouter.use('/management', managementRoutes);
apiRouter.use('/payroll', payrollRoutes);
apiRouter.use('/schedule', scheduleRoutes);
apiRouter.use('/costs', costRoutes);
apiRouter.use('/sla', slaRoutes);

export {
  authRoutes,
  ticketRoutes,
  notificationRoutes,
  uploadRoutes,
  managementRoutes,
  payrollRoutes,
  scheduleRoutes,
  costRoutes,
  slaRoutes,
};

export default apiRouter;

