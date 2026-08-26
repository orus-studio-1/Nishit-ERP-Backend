import { Router } from 'express';
import {
  getEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee,
  getDepartments, createDepartment, updateDepartment, deleteDepartment,
  getPositions, createPosition, updatePosition, deletePosition,
  getAttendance, markAttendance,
  getLeaveTypes, createLeaveType, getLeaveBalances,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest,
  getPayrolls, generatePayroll, updatePayrollStatus,
  getMyHrProfile, updateMyHrProfile, getMyAttendance, createEmployeeCheckin,
  getShiftTypes, createShiftType, updateShiftType, getShiftAssignments, assignShift, updateShiftAssignment, getShiftRoster, markShiftAutoAttendance,
  getLeavePeriods, createLeavePeriod, getLeaveAllocations, createLeaveAllocation, getLeaveLedger, getLeavePolicies, createLeavePolicy,
  getSalaryComponents, createSalaryComponent, getSalaryStructures, createSalaryStructure, assignSalaryStructure,
  getPayrollEntries, generatePayrollEntry, updatePayrollEntryStatus,
  getSalarySlips, getMySalarySlips, getSalarySlip,
  getLifecycleEvents, createLifecycleEvent, updateLifecycleEventStatus,
  getHrDashboard,
} from '../controllers/hr.controller';
import { authenticate, authorize, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);

const hrRoles = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'HR_OFFICER'];
const payrollRoles = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];
const managerRoles = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'HR_OFFICER', 'MANAGER'];

router.get('/dashboard', authorize(...hrRoles, 'PAYROLL_OFFICER', 'MANAGER', 'EMPLOYEE'), getHrDashboard);

router.route('/me').get(getMyHrProfile).patch(updateMyHrProfile);
router.get('/me/attendance', getMyAttendance);
router.post('/me/checkins', createEmployeeCheckin);
router.get('/me/salary-slips', getMySalarySlips);

router.use(requireModuleAccess('hr'));

router.route('/employees').get(authorize(...hrRoles, 'PAYROLL_OFFICER', 'MANAGER'), getEmployees).post(authorize(...hrRoles), createEmployee);
router.route('/employees/:id').get(authorize(...hrRoles, 'PAYROLL_OFFICER', 'MANAGER'), getEmployee).put(authorize(...hrRoles), updateEmployee).delete(authorize(...hrRoles), deleteEmployee);

router.route('/departments').get(getDepartments).post(authorize(...hrRoles), createDepartment);
router.route('/departments/:id').put(authorize(...hrRoles), updateDepartment).delete(authorize(...hrRoles), deleteDepartment);

router.route('/positions').get(getPositions).post(authorize(...hrRoles), createPosition);
router.route('/positions/:id').put(authorize(...hrRoles), updatePosition).delete(authorize(...hrRoles), deletePosition);

router.route('/attendance').get(authorize(...hrRoles, 'MANAGER'), getAttendance).post(authorize(...hrRoles), markAttendance);
router.route('/shift-types').get(authorize(...hrRoles), getShiftTypes).post(authorize(...hrRoles), createShiftType);
router.put('/shift-types/:id', authorize(...hrRoles), updateShiftType);
router.route('/shift-assignments').get(authorize(...hrRoles), getShiftAssignments).post(authorize(...hrRoles), assignShift);
router.put('/shift-assignments/:id', authorize(...hrRoles), updateShiftAssignment);
router.get('/shift-roster', authorize(...hrRoles, 'MANAGER'), getShiftRoster);
router.post('/shift-auto-attendance', authorize(...hrRoles), markShiftAutoAttendance);

router.route('/leave-types').get(getLeaveTypes).post(authorize(...hrRoles), createLeaveType);
router.route('/leave-periods').get(authorize(...hrRoles), getLeavePeriods).post(authorize(...hrRoles), createLeavePeriod);
router.get('/leave-balances', authorize(...hrRoles, 'MANAGER', 'EMPLOYEE'), getLeaveBalances);
router.route('/leave-policies').get(authorize(...hrRoles), getLeavePolicies).post(authorize(...hrRoles), createLeavePolicy);
router.route('/leave-allocations').get(authorize(...hrRoles, 'MANAGER'), getLeaveAllocations).post(authorize(...hrRoles), createLeaveAllocation);
router.get('/leave-ledger', authorize(...hrRoles, 'MANAGER'), getLeaveLedger);

router.route('/leave-requests').get(authorize(...managerRoles, 'EMPLOYEE'), getLeaveRequests).post(createLeaveRequest);
router.put('/leave-requests/:id/approve', authorize(...managerRoles), approveLeaveRequest);
router.patch('/leave-requests/:id/approve', authorize(...managerRoles), approveLeaveRequest);

router.route('/payroll').get(authorize(...payrollRoles), getPayrolls).post(authorize(...payrollRoles), generatePayroll);
router.put('/payroll/:id/status', authorize(...payrollRoles), updatePayrollStatus);

router.route('/salary-components').get(authorize(...payrollRoles), getSalaryComponents).post(authorize(...payrollRoles), createSalaryComponent);
router.route('/salary-structures').get(authorize(...payrollRoles), getSalaryStructures).post(authorize(...payrollRoles), createSalaryStructure);
router.post('/salary-structure-assignments', authorize(...payrollRoles), assignSalaryStructure);
router.route('/payroll-entries').get(authorize(...payrollRoles), getPayrollEntries).post(authorize(...payrollRoles), generatePayrollEntry);
router.patch('/payroll-entries/:id/status', authorize(...payrollRoles), updatePayrollEntryStatus);
router.get('/salary-slips', authorize(...payrollRoles), getSalarySlips);
router.get('/salary-slips/:id', getSalarySlip);

router.route('/lifecycle-events').get(authorize(...hrRoles), getLifecycleEvents).post(authorize(...hrRoles), createLifecycleEvent);
router.patch('/lifecycle-events/:id/status', authorize(...hrRoles), updateLifecycleEventStatus);

export default router;
