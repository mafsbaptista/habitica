import moment from 'moment';
import { authWithHeaders } from '../../middlewares/auth';
import cron from '../../middlewares/cron';
import { model as User } from '../../models/user';
import * as Tasks from '../../models/task';
import { model as Group } from '../../models/group';

const api = {};

/**
 * @api {post} /api/v3/cron Run cron
 * @apiName Cron
 * @apiDescription This causes cron to run. It assumes that the user has already been shown
 * the Record Yesterday's Activity ("Check off any Dailies you did yesterday") screen and
 * so it will immediately apply damage for incomplete due Dailies.
 * @apiGroup Cron
 *
 * @apiSuccess {Object} data An empty Object
 */
api.cron = {
  method: 'POST',
  url: '/cron',
  middlewares: [authWithHeaders(), cron],
  async handler (req, res) {
    res.respond(200, {});
  },
};

api.cron_admin = {
  method: 'POST',
  url: '/cron/:user',
  middlewares: [authWithHeaders()],
  async handler (req, res) {
    const cronResult = await cronSync(req, res);
    console.log('End');
    return res.respond(200, cronResult);
  },
};

async function cronSync (req, res) {
  let { user } = res.locals;
  const id = req.params.user;
  if (!user) return null; // User might not be available when authentication is not mandatory

  const { analytics } = res;
  const now = new Date();

  user = await User.findOne({ _id: id }).exec();
  res.locals.user = user;
  const { daysMissed, timezoneUtcOffsetFromUserPrefs } = user.daysUserHasMissed(now, req);

  user.enrollInDropCapABTest(req.headers['x-client']);
  await updateLastCron(user, now);

  console.log('Step. 3');

  if (daysMissed <= 0) {
    if (user.isModified()) await user.save();
    await unlockUser(user);
    return null;
  }

  const tasks = await Tasks.Task.find({
    userId: user._id,
    $or: [ // Exclude completed todos
      { type: 'todo', completed: false },
      { type: { $in: ['habit', 'daily', 'reward'] } },
    ],
  }).exec();

  console.log('Step. 1');

  const tasksByType = {
    habits: [], dailys: [], todos: [], rewards: [],
  };
  tasks.forEach(task => tasksByType[`${task.type}s`].push(task));

  // Run cron
  const progress = cron({
    user,
    tasksByType,
    now,
    daysMissed,
    analytics,
    timezoneUtcOffsetFromUserPrefs,
    headers: req.headers,
  });

  // Clear old completed todos - 30 days for free users, 90 for subscribers
  // Do not delete challenges completed todos TODO unless the task is broken?
  // Do not delete group completed todos
  Tasks.Task.remove({
    userId: user._id,
    type: 'todo',
    completed: true,
    dateCompleted: {
      $lt: moment(now).subtract(user.isSubscribed() ? 90 : 30, 'days').toDate(),
    },
    'challenge.id': { $exists: false },
    'group.id': { $exists: false },
  }).exec();

  res.locals.wasModified = true; // TODO remove after v2 is retired

  Group.tavernBoss(user, progress);

  // Save user and tasks
  const toSave = [user.save()];
  tasks.forEach(async task => {
    if (task.isModified()) toSave.push(task.save());
    if (task.isModified() && task.group && task.group.taskId) {
      const groupTask = await Tasks.Task.findOne({
        _id: task.group.taskId,
      }).exec();

      if (groupTask) {
        let delta = (0.9747 ** task.value) * -1;
        if (groupTask.group.assignedUsers) delta /= groupTask.group.assignedUsers.length;
        await groupTask.scoreChallengeTask(delta, 'down');
      }
    }
  });
  await Promise.all(toSave);

  await Group.processQuestProgress(user, progress);

  // Set _cronSignature, lastCron and auth.timestamps.loggedin to signal end of cron
  await User.update({
    _id: user._id,
  }, {
    $set: {
      _cronSignature: 'NOT_RUNNING',
    },
  }).exec();

  // Reload user
  res.locals.user = await User.findOne({ _id: user._id }).exec();
  return null;
}

// Auxiliar

async function updateLastCron (user, now) {
  await User.update({
    _id: user._id,
  }, {
    lastCron: now, // setting lastCron now so we don't risk re-running parts of cron if it fails
  }).exec();
}

async function unlockUser (user) {
  await User.update({
    _id: user._id,
  }, {
    _cronSignature: 'NOT_RUNNING',
  }).exec();
}


export default api;
