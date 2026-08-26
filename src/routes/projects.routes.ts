import { Router } from 'express';
import {
  getProjects, getProject, createProject, updateProject, deleteProject,
  addProjectMember, removeProjectMember,
  getTasks, getTask, createTask, updateTask, deleteTask,
  getMilestones, createMilestone, updateMilestone, deleteMilestone,
  getComments, createComment, deleteComment,
} from '../controllers/projects.controller';
import { authenticate, requireModuleAccess } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(requireModuleAccess('projects'));

router.route('/').get(getProjects).post(createProject);
router.route('/:id').get(getProject).put(updateProject).delete(deleteProject);
router.post('/:id/members', addProjectMember);
router.delete('/:id/members/:userId', removeProjectMember);

router.route('/tasks/all').get(getTasks);
router.route('/tasks').post(createTask);
router.route('/tasks/:id').get(getTask).put(updateTask).delete(deleteTask);

router.route('/milestones').get(getMilestones).post(createMilestone);
router.route('/milestones/:id').put(updateMilestone).delete(deleteMilestone);

router.route('/comments').get(getComments).post(createComment);
router.delete('/comments/:id', deleteComment);

export default router;
