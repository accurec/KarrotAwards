// TODO: Add logging to file
// TODO: create proper summaries and annotations for functions/classes
// TODO: refactor all variables from being var_name to varName
// TODO: Add proper logging for all outgoing/incoming requests/results with DateTime stamps
// TODO: Somehow modularize the app? so that helper methods are in other file? Also maybe app event listeners could be also in a different file(s)?
// TODO: Add throtthling, so that users don't DDOS /karrotawards leaderboard or /karrotawards scorecard @user
// TODO: Add logic to also randomly pick announcement messages for scorecard and stats
// TODO: Add logic to calculate final score based on number of awards and their weight and show it in the final table, also sort users and show leaderboard based on that calculated number
// TODO: Replace send ephemeral functions with just one and instead reuse const strings for the method

// Configuration.
require('dotenv').config();
// 3rd party packages to make our life easier with images download and HTML to image generation.
const got = require('got');
const nodeHtmlToImage = require('node-html-to-image');
// Atlas MongoDB.
const { MongoClient, ObjectId } = require("mongodb");
// Slack related packages.
const { App } = require("@slack/bolt");
const { WebClient, LogLevel } = require("@slack/web-api");
// Custom built classes to support this application.
const { ModalHelper, AwardsModalSubmissionPayload } = require("./entities/modal.js");
const { HtmlTable } = require('./entities/htmlTable.js');

// Connection string to Atlas MongoDB, will be used to instantiate clients to read/write data.
const mongoDbUri = `mongodb+srv://${process.env.MONGODB_USER_NAME}:${process.env.MONGODB_USER_PASSWORD}@${process.env.MONGODB_CLUSTER_URL}/${process.env.MONGODB_NAME}?retryWrites=true&w=majority`;

// Initialize the Bolt app with bot token and signing secret.
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.INFO
});

/**
 * Function to instantiate the new client for Atlas MongoDB to access data in it.
 * @param {String} uri Uri connection string for the Atlas MongoDB.
 */
function createMongoClient(uri) {
  return new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
}

/**
 * Wrapper function to send ephemeral generic working on it message to the user.
 * @param {WebClient} client Slack Bolt WebClient that allows to use Slack WebApi methods.
 * @param {String} userId Slack user identifier.
 * @param {String} channelId Slack channel identifier.
 */
async function sendWorkingOnItEphemeralToUser(client, userId, channelId) {
  await sendEphemeralToUser(client, userId, channelId, ':man-biking: Working on it, please wait. :woman-biking:');
}

/**
 * Wrapper function to send ephemeral generic error message to the user.
 * @param {WebClient} client Slack Bolt WebClient that allows to use Slack WebApi methods.
 * @param {String} userId Slack user identifier.
 * @param {String} channelId Slack channel identifier.
 */
async function sendErrorEphemeralToUser(client, userId, channelId) {
  await sendEphemeralToUser(client, userId, channelId, 'Something went wrong :cry: Please try again later :rewind:');
}

/**
 * Function to send ephemeral message to the user.
 * @param {WebClient} client Slack Bolt WebClient that allows to use Slack WebApi methods.
 * @param {String} userId Slack user identifier.
 * @param {String} channelId Slack channel identifier.
 * @param {String} text Text that will be sent to the user.
 * @param {String} attachments Attachments that are going to be sent along with the text to the user.
 */
async function sendEphemeralToUser(client, userId, channelId, text, attachments = null) {
  try {
    const ephemeralResult = await client.chat.postEphemeral({
      text: text,
      user: userId,
      channel: channelId,
      attachments: attachments
    });

    console.debug(`Send ephemeral text [${text}] with attachments [${JSON.stringify(attachments)}] to user [${userId}] in channel [${channelId}] result: ${JSON.stringify(ephemeralResult)}.`);
  }
  catch (error) {
    console.error(`There was an error sending ephemeral message to user [${userId}] in channel [${channelId}]. ${error}`);
  }
}

/**
 * Function to notify a user about what kind of commands can be invoked for this application.
 * @param {String} commandRequester User id and name that initiated the command.
 * @param {WebClient} client Bolt web client that is going to be used to send ephemeral message using Slack API.
 * @param {String} userId User id to which the message should be sent.
 * @param {String} channelId Channel id where the message will be shown.
 */
async function handleHelpCommand(commandRequester, client, userId, channelId) {
  console.log(`${new Date()} -> Got request from [${commandRequester}] to show help.`);

  await sendEphemeralToUser(client, userId, channelId, 'How to use KarrotAwards:',
    [{
      color: "#0015ff",
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `To give someone one or multiple awards you can use \`/karrotawards\`.\nTo see the leaderboard you can use \`/karrotawards leaderboard\`. It will display top ${process.env.LEADERBOARD_NUMBER_OF_USERS} performers!\nTo see which awards certain user currently have you can use \`/karrotawards scorecard @someone\`. Note that if you mention multiple users, only the first one mentioned will be displayed.`
            }
          ]
        }
      ]
    }]);
}

/**
 * Function get rewards data from the DB and send modal to the user.
 * @param {String} commandRequester User id and name that initiated the command.
 * @param {WebClient} client Bolt web client that is going to be used to send ephemeral message using Slack API in case something goes wrong and we need to notify user about it.
 * @param {String} userId User id to which the message should be sent.
 * @param {String} channelId Channel id where the message will be shown.
 * @param {String} triggerId In case everything is fine and the modal is ready, trigger id is needed to send the modal to the user.
 */
async function handleAwardRequestCommand(commandRequester, client, userId, channelId, triggerId) {
  console.log(`${new Date()} -> Got request from [${commandRequester}] to assign an award.`);

  const mongoClient = createMongoClient(mongoDbUri);
  let dbAwards = [];

  try {
    await mongoClient.connect();
    dbAwards = await mongoClient.db().collection("Awards").find().toArray();

    if (Object.entries(dbAwards).length === 0) {
      throw ('There is no awards available in the DB.');
    }
  }
  catch (error) {
    console.error(`There was an error getting awards from the DB. ${error}`);
    await sendErrorEphemeralToUser(client, userId, channelId);
    return;
  }
  finally {
    await mongoClient.close();
  }

  try {
    await client.views.open({
      trigger_id: triggerId,
      view: ModalHelper.generateAwardsModal(channelId, dbAwards.map(dbAward => { return { text: `${dbAward.userText} ${dbAward.text}`, value: `award-select-value-${dbAward._id}` }; }))
    });
  }
  catch (error) {
    console.error(`There was an error creating the modal sending it to the user. ${error}`);
    await sendErrorEphemeralToUser(client, userId, channelId);
  }
}

async function handleLeaderboardCommand() {
  console.log(`${new Date()} -> Got request from [${commandRequester}] to display scorecard.`);

  await sendWorkingOnItEphemeralToUser(client, body.user_id, body.channel_id);

  // TODO: Refactor getting the awards and user stats into separate functions
  // Get users according to the filter, get all awards
  const mongoClient = createMongoClient(mongoDbUri);
  let userStats = [];
  let awards = [];

  try {
    await mongoClient.connect();
    // TODO: This can be reused for a singe user too, need to just see here, if the userId is passed or not. In case not then we're looking for all users
    userStats = await mongoClient.db().collection("ScoreCards").find().toArray();
    awards = await mongoClient.db().collection("Awards").find().toArray();
  }
  catch (error) {
    console.error(`There was an error getting user stats and/or awards from the DB. Sending ephemeral to user and returning. ${error}`);
    await sendEphemeralToUser(client, body.user_id, body.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
    return;
  }
  finally {
    mongoClient.close();
  }

  // TODO: Somehow track and do not display deleted/inactive/locked users, possibly even have a process to remove them from the scorecard table in DB. Need to combine this with the users.list to see which accounts have been deleted
  // Get user names. Use Promise.all to get them all at once. Use client.users.profile.get and remember that method doesn't return user id as a result. 
  // For now just display anybody that has ever been awarded something (unless we can't retrieve the profile).
  // Also see if profile wasn't retrieved, we need to remove it from the final list.
  await Promise.all(userStats.map(async (userStat) => {
    const userId = userStat.userId;

    try {
      const response = await client.users.profile.get({ user: userId });
      userStat['display_name'] = response.profile.display_name === '' ? response.profile.real_name : response.profile.display_name;
      userStat['awardsCount'] = []; // This is going to be needed later. TODO: Need to create this later when we generate this list and not here
    }
    catch (error) {
      userStats = userStats.filter(stat => { return stat.userId != userId });
      console.error(`Failed to retrieve user [${userId}] profile. It was removed from the display list. ${error}`);
    }
  }));

  // Get all custom emojis from Slack
  let slackEmojisLinks = {};

  try {
    slackEmojisLinks = (await client.emoji.list()).emoji;
  }
  catch (error) {
    console.error(`There was an error getting emojis from Slack. Sending ephemeral to user. ${error}`);
    await sendEphemeralToUser(client, body.user_id, body.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
    return;
  }

  // Compile list of emojis to download from Slack. If emoji is an alias, do not include it in the list
  awards.forEach(currtentAward => {
    const awardUrl = slackEmojisLinks[currtentAward.text.split(':')[1]];

    if (awardUrl == null || awardUrl.includes('alias')) {
      awards = awards.filter(award => { return award.text != currtentAward.text });
    }
    else {
      currtentAward['url'] = awardUrl;
    }
  });

  // Download images of emojis from Slack
  await Promise.all(awards.map(async (award) => {
    try {
      const response = await got(award.url, { responseType: 'buffer' });
      award['urlContents'] = response.body;
    }
    catch (error) {
      console.log(error.response.body);
    }
  }));

  // Order both award images and users awards so that they are matching. Add 0 if users don't have certain award
  awards.forEach(award => {
    userStats.forEach(userStat => {
      const userAward = userStat.awards.filter(userAward => { return userAward.awardId.equals(award._id) }).pop();

      if (userAward == null) {
        userStat.awardsCount.push(0);
      }
      else {
        userStat.awardsCount.push(userAward.count);
      }
    })
  });

  // Generate HTML, image
  const htmlTable = new HtmlTable(awards.map(award => { return { name: award._id, description: award.userText } }));
  userStats.forEach(userStat => { htmlTable.add_row(userStat.display_name, userStat.awardsCount) });
  htmlTable.complete();

  const imageContent = {};
  awards.forEach(award => { imageContent[award._id] = 'data:image/jpeg;base64,' + award.urlContents.toString('base64'); }); // TODO: Do I need to set proper type here (jpeg, png, etc.)?

  const scorecardImage = await nodeHtmlToImage({
    html: htmlTable.contents,
    content: imageContent,
    beforeScreenshot: async (page) => {
      const tableSize = await page.$eval('#mainTable', el => [el.clientWidth, el.clientHeight]);
      await page.addStyleTag({ content: `body {width:${tableSize[0]}px;height:${tableSize[1]}px;}` }) // This is needed so that the screenshot is properly sized to the size of the table
    }
  });

  // Send image to Slack
  try {
    const uploadResult = await client.files.upload({ file: scorecardImage, filetype: 'binary', channels: body.channel_id, title: ':arrow_down:', initial_comment: `:sunglasses: Requested by the fabulous <@${body.user_id}>! :sunglasses:\n:fireworks: KarrotAwards Leaderboard! :fireworks:` });
  }
  catch (error) {
    console.log(error);
  }
}

async function handleScorecardCommand() {
  console.log(`${new Date()} -> Got request from [${commandRequester}] to display awards for a single user.`);

  // Parse message and get Id of the first user encountered
  let userIdToShow = (body.text.match(/<@[\d\w]+\|/g) || []).pop();

  if (userIdToShow == null) {
    await sendEphemeralToUser(client, body.user_id, body.channel_id, 'You didn\'t specify which user scorecard you would like to see. Please try again.');
  }
  else {
    userIdToShow = userIdToShow.substr(2, userIdToShow.length - 3);
    console.log(`Getting scorecard for the user id [${userIdToShow}].`);
    // TODO: Generate image and send back to the user with ephemeral.
  }
}

app.command('/karrotawards', async ({ ack, body, client }) => {
  // As per spec, acknowledge first
  await ack();

  const commandRequester = `${body.user_id}:${body.user_name}`;

  // Flow to show user private message about capabilities of this application
  if (body.text.toLowerCase() === 'help') {
    await handleHelpCommand(commandRequester, client, body.user_id, body.channel_id);
  }
  // Main flow to give someone an award
  else if (body.text === '') {
    await handleAwardRequestCommand(commandRequester, client, body.user_id, body.channel_id, body.trigger_id);
  }
  // Flow to generate full scorecard list, convert it to HTML table, then image and then send it back to the channel. Show top env.LEADERBOARD_NUMBER_OF_USERS users
  else if (body.text.toLowerCase() === 'leaderboard') {
    await handleLeaderboardCommand();
  }
  // Flow to show stats for just one user specified in the request
  else if (body.text.toLowerCase().includes('scorecard')) {
    await handleScorecardCommand();
  }
});

app.view('modal_submission', async ({ ack, body, view, client }) => {
  const viewSubmissionPayload = new AwardsModalSubmissionPayload(body, view);
  const errors = ModalHelper.validateModalSubmissionPayload(viewSubmissionPayload);

  if (Object.entries(errors).length > 0) {
    await ack({
      response_action: 'errors',
      errors: errors
    });

    console.debug('User input was not valid. Returning.');
    return;
  }
  else {
    await ack();
  }

  await sendWorkingOnItEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId);

  // Create new MongoDB client
  let mongoClient = createMongoClient(mongoDbUri);

  // Get message template from DB
  let message = '';

  try {
    await mongoClient.connect();
    const messageTemplatesCollection = mongoClient.db().collection("MessageTemplates");
    const messageTemplateIds = await messageTemplatesCollection.find().project({ _id: 1 }).toArray();

    if (Object.entries(messageTemplateIds).length === 0) {
      console.log('No message templates available! Sending ephemeral to user and returning.');
      await sendEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId, 'Something went wrong :cry: Please try again later :rewind:');
      return;
    }

    const item = await messageTemplatesCollection.findOne({ _id: messageTemplateIds[Math.floor(Math.random() * messageTemplateIds.length)]._id });
    message = item.text;
  }
  catch (error) {
    console.error(`There was an error getting message template from the DB. Sending ephemeral to user and returning. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId, 'Something went wrong :cry: Please try again later :rewind:');
    return;
  }
  finally {
    await mongoClient.close();
  }

  // Save the stats to the DB
  // Create new MongoDB client
  mongoClient = createMongoClient(mongoDbUri);

  try {
    await mongoClient.connect();
    const scoreCardsCollection = mongoClient.db().collection("ScoreCards");
    const currentUserStats = await scoreCardsCollection.find({ $or: viewSubmissionPayload.selectedUsers.map(userId => { return { userId: userId }; }) }).toArray();

    const updatedUserStats = [];

    viewSubmissionPayload.selectedUsers.forEach(userId => {
      let currentUserStat = currentUserStats.filter(item => { return item.userId === userId }).pop();

      if (currentUserStat == null) { currentUserStat = { userId: userId, awards: [] }; }

      viewSubmissionPayload.selectedAwards.forEach(submittedAward => {
        const currentUserAward = currentUserStat.awards.filter(award => { return award.awardId.toString() === submittedAward.id }).pop();
        currentUserAward == null ? currentUserStat.awards.push({ awardId: ObjectId(submittedAward.id), count: 1 }) : currentUserAward.count++;
      });

      updatedUserStats.push(currentUserStat);
    });

    const bulkDBUpsertOperation = scoreCardsCollection.initializeUnorderedBulkOp();

    updatedUserStats.forEach(userStat => {
      bulkDBUpsertOperation.find({ userId: userStat.userId }).upsert().replaceOne({
        userId: userStat.userId,
        awards: userStat.awards
      });
    });

    let bulkOpExecResult = await bulkDBUpsertOperation.execute();
  }
  catch (error) {
    console.error(`There was an error saving stats to the DB. Sending ephemeral to user and returning. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId, 'Something went wrong :cry: Please try again later :rewind:');
    return;
  }
  finally {
    mongoClient.close();
  }

  // Send message back to the channel
  try {
    // TODO: Add "and" instead of the "," if multiple users, awards are present
    message = message.replace(/{sender}/gi, `<@${viewSubmissionPayload.userId}>`);
    message = message.replace(/{receiver}/gi, viewSubmissionPayload.selectedUsers.map(user => { return `<@${user}>`; }).toString().replace(/,/gi, ', '));
    message = message.replace(/{award}/gi, viewSubmissionPayload.selectedAwards.map(award => { return award['emoji']; }).toString().replace(/,/gi, ', '));
    message = message.replace(/{attachmentText}/gi, viewSubmissionPayload.attachmentText == null ? '' : viewSubmissionPayload.attachmentText);

    await client.chat.postMessage({
      channel: viewSubmissionPayload.channelId,
      text: message
    });
  }
  catch (error) {
    console.error(`There was an error generating and posting final message to the channel. Sending ephemeral to user. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId, 'Something went wrong :cry: Please try again later :rewind:');
  }
});

// Main -> start the Bolt app.
(async () => {
  await app.start(process.env.APP_PORT);
  console.log('KarrotAwards -> ⚡️ Bolt app is running!');
})();