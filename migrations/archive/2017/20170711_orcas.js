let migrationName = '20170711_orcas.js';
let authorName = 'Sabe'; // in case script author needs to know when their ...
let authorUuid = '7f14ed62-5408-4e1b-be83-ada62d504931'; // ... own data is done

/*
 * Award Orca pets to owners of Orca mount, and Orca mount to everyone else
 */

let monk = require('monk');
let connectionString = 'mongodb://localhost:27018/habitrpg?auto_reconnect=true'; // FOR TEST DATABASE
let dbUsers = monk(connectionString).get('users', { castIds: false });

function processUsers (lastId) {
  // specify a query to limit the affected users (empty for all users):
  let query = {
    migration: {$ne: migrationName},
  };

  if (lastId) {
    query._id = {
      $gt: lastId,
    };
  }

  dbUsers.find(query, {
    sort: {_id: 1},
    limit: 250,
    fields: [
      'items.mounts',
    ], // specify fields we are interested in to limit retrieved data (empty if we're not reading data):
  })
    .then(updateUsers)
    .catch(function (err) {
      console.log(err);
      return exiting(1, `ERROR! ${  err}`);
    });
}

let progressCount = 1000;
let count = 0;

function updateUsers (users) {
  if (!users || users.length === 0) {
    console.warn('All appropriate users found and modified.');
    displayData();
    return;
  }

  let userPromises = users.map(updateUser);
  let lastUser = users[users.length - 1];

  return Promise.all(userPromises)
    .then(function () {
      processUsers(lastUser._id);
    });
}

function updateUser (user) {
  count++;

  let set = {};

  if (user.items.mounts['Orca-Base']) {
    set = {migration: migrationName, 'items.pets.Orca-Base': 5};
  } else {
    set = {migration: migrationName, 'items.mounts.Orca-Base': true};
  }

  dbUsers.update({_id: user._id}, {$set: set});

  if (count % progressCount === 0) console.warn(`${count  } ${  user._id}`);
  if (user._id === authorUuid) console.warn(`${authorName  } processed`);
}

function displayData () {
  console.warn(`\n${  count  } users processed\n`);
  return exiting(0);
}

function exiting (code, msg) {
  code = code || 0; // 0 = success
  if (code && !msg) {
    msg = 'ERROR!';
  }
  if (msg) {
    if (code) {
      console.error(msg);
    } else      {
      console.log(msg);
    }
  }
  process.exit(code);
}

module.exports = processUsers;
