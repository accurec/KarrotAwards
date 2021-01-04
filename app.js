// TODO: Add logging to file
// TODO: create proper summaries and annotations for functions/classes
// TODO: Add proper logging for all outgoing/incoming requests/results with DateTime stamps
// TODO: Add throtthling, so that users don't DDOS /karrotawards leaderboard or /karrotawards scorecard @user

require('dotenv').config();
const got = require('got');
const nodeHtmlToImage = require('node-html-to-image');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ObjectId } = require("mongodb");
const { App } = require("@slack/bolt");
const { WebClient, LogLevel } = require("@slack/web-api");
const { ModalHelper, AwardsModalSubmissionPayload } = require("./Modal.js");
const { HtmlTableHelper } = require('./HtmlTable.js');

const mongoDbUri = `mongodb+srv://${process.env.MONGODB_USER_NAME}:${process.env.MONGODB_USER_PASSWORD}@${process.env.MONGODB_CLUSTER_URL}/${process.env.MONGODB_NAME}?retryWrites=true&w=majority`;
const uDropBaseUrl = 'https://www.udrop.com/';
const userErrorMessage = 'Something went wrong :cry: Please try again later :rewind:';
const workingOnItMessage = ':man-biking: Working on it, please wait. :woman-biking:';
const attachmentsColor = '#0015ff';
const defaultMessageTemplate = '{sender} said "{attachmentText}" and awarded {receiver} with {award}.';

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
  try {
    return new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  }
  catch (error) {
    console.error(`There was an error creating mongo client for uri [${uri}]. ${error}`);
  }
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
    await client.chat.postEphemeral({
      text: text,
      user: userId,
      channel: channelId,
      attachments: attachments
    });
  }
  catch (error) {
    console.error(`There was an error sending ephemeral message to user [${userId}] in channel [${channelId}]. ${error}`);
  }
}

async function generateScorecardImage(client, userId, channelId, targetUserId = null) {
  await sendEphemeralToUser(client, userId, channelId, workingOnItMessage);

  const mongoClient = createMongoClient(mongoDbUri);
  let userStats = [];
  let awards = [];

  try {
    await mongoClient.connect();

    if (targetUserId == null) {
      userStats = await mongoClient.db().collection("ScoreCards").find().toArray();
    }
    else {
      const userStat = await mongoClient.db().collection("ScoreCards").findOne({ userId: targetUserId });

      if (userStat != null) {
        userStats.push(userStat);
      }
    }

    awards = await mongoClient.db().collection("Awards").find().toArray();
  }
  catch (error) {
    console.error(`There was an error getting user stats and/or awards from the DB while trying to generate scorecard image. ${error}`);
    await sendEphemeralToUser(client, userId, channelId, userErrorMessage);
    return;
  }
  finally {
    await mongoClient.close();
  }

  // Get user display handles in parallel, because we do not store them in DB
  await Promise.all(userStats.map(async (userStat) => {
    const userId = userStat.userId;

    try {
      const response = await client.users.profile.get({ user: userId });
      userStat['displayName'] = response.profile.display_name === '' ? response.profile.real_name : response.profile.display_name;
    }
    catch (error) {
      userStats = userStats.filter(stat => { return stat.userId !== userId });
      console.error(`Failed to retrieve user [${userId}] profile. It was removed from the display list. ${error}`);
    }
  }));

  if (Object.entries(userStats).length === 0) {
    await sendEphemeralToUser(client, userId, channelId, 'Sorry, I don\'t have any data for that yet :cry:');
    return;
  }

  // Get all custom emojis from Slack
  let slackEmojisLinks = {};

  try {
    slackEmojisLinks = (await client.emoji.list()).emoji;
  }
  catch (error) {
    console.error(`There was an error getting custom emojis list from Slack. ${error}`);
    await sendEphemeralToUser(client, userId, channelId, userErrorMessage);
    return;
  }

  // Compile list of emojis to download from Slack. If emoji is an alias, do not include it in the list, otherwise assign download link to the award object
  awards.forEach(currtentAward => {
    const awardUrl = slackEmojisLinks[currtentAward.text.split(':')[1]];

    if (awardUrl == null || awardUrl.toLowerCase().includes('alias')) {
      awards = awards.filter(award => { return award.text !== currtentAward.text });
    }
    else {
      currtentAward['url'] = awardUrl;
    }
  });

  // Download images of emojis from Slack. Assign the result buffer data to the property of the award object
  await Promise.all(awards.map(async (award) => {
    try {
      const response = await got(award.url, { responseType: 'buffer' });
      award['urlContents'] = response.body;
    }
    catch (error) {
      awards = awards.filter(award => { return award.url !== currtentAward.url });
      console.error(`There was an error downloading emoji url [${award.url}]. ${error.response.body}`);
    }
  }));

  if (Object.entries(awards).length === 0) {
    await sendEphemeralToUser(client, userId, channelId, userErrorMessage);
    return;
  }

  // Generate awards array that matches the order of the awards array. Also calculate total score for each user
  userStats.forEach(userStat => {
    userStat['awardsCount'] = [];
    let totalUserScore = 0;

    awards.forEach(award => {
      const userAward = userStat.awards.filter(userAward => { return userAward.awardId.equals(award._id) }).pop();

      if (userAward == null) {
        userStat.awardsCount.push(0);
      }
      else {
        userStat.awardsCount.push(userAward.count);
        totalUserScore += userAward.count * award.weight;
      }
    });

    userStat.awardsCount.push(totalUserScore);
  });

  // Generate HTML, image for the top LEADERBOARD_NUMBER_OF_USERS
  const scorecardImage = await nodeHtmlToImage({
    html: HtmlTableHelper.generateHTMLTable(awards, (targetUserId == null ? userStats.sort((a, b) => b.awardsCount.slice(-1) - a.awardsCount.slice(-1)).slice(0, process.env.LEADERBOARD_NUMBER_OF_USERS) : userStats)).contents,
    content: awards.reduce((current, award) => {
      current[award._id] = `data:image/jpeg;base64,${award.urlContents.toString('base64')}`;
      return current;
    }, {}), // TODO: image/jpeg seems to be working fine for all original formats such as png, gif, jpeg, jpg. Not sure if I need to bother converting it according to the original extension 
    beforeScreenshot: async (page) => {
      const tableSize = await page.$eval('#mainTable', el => [el.clientWidth, el.clientHeight]);
      await page.addStyleTag({ content: `body {width:${tableSize[0]}px;height:${tableSize[1]}px;}` }) // This is needed so that the screenshot is properly sized to the size of the table
    }
  });

  return scorecardImage;
}

/**
 * Function to notify a user about what kind of commands can be invoked for this application.
 * @param {WebClient} client Bolt web client that is going to be used to send ephemeral message using Slack API.
 * @param {String} userId User id to which the message should be sent.
 * @param {String} channelId Channel id where the message will be shown.
 */
async function handleHelpCommand(client, userId, channelId) {
  await sendEphemeralToUser(client, userId, channelId, 'How to use KarrotAwards:',
    [{
      color: attachmentsColor,
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
 * @param {WebClient} client Bolt web client that is going to be used to send ephemeral message using Slack API in case something goes wrong and we need to notify user about it.
 * @param {String} userId User id to which the message should be sent.
 * @param {String} channelId Channel id where the message will be shown.
 * @param {String} triggerId In case everything is fine and the modal is ready, trigger id is needed to send the modal to the user.
 */
async function handleAwardRequestCommand(client, userId, channelId, triggerId) {
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
    await sendEphemeralToUser(client, userId, channelId, userErrorMessage);
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
    console.error(`There was an error creating the modal and sending it to the user. ${error}`);
    await sendEphemeralToUser(client, userId, channelId, userErrorMessage);
  }
}

async function handleLeaderboardCommand(client, userId, channelId) {
  const scorecardImage = await generateScorecardImage(client, userId, channelId);

  if (scorecardImage != null) {
    try {
      await client.files.upload({
        file: scorecardImage,
        iletype: 'binary',
        channels: channelId,
        title: ':arrow_down:',
        initial_comment: `:sunglasses: Requested by the fabulous <@${userId}>! :sunglasses:\n:fireworks: KarrotAwards Top ${process.env.LEADERBOARD_NUMBER_OF_USERS} Leaderboard! :fireworks:`
      });
    }
    catch (error) {
      console.error(`There was an error handling leaderboard command. ${error}`);
      await sendEphemeralToUser(client, userId, channelId, userErrorMessage);  
    }
  }
}

async function handleScorecardCommand(client, commandText, userId, channelId) {
  // Parse message and get Id of the first user encountered
  let userIdToShow = (commandText.match(/<@[\d\w]+\|/g) || []).pop();

  if (userIdToShow == null) {
    await sendEphemeralToUser(client, userId, channelId, 'You didn\'t specify which user scorecard you would like to see. Please try again.');
  }
  else {
    userIdToShow = userIdToShow.substr(2, userIdToShow.length - 3);

    const scorecardImage = await generateScorecardImage(client, userId, channelId, userIdToShow);

    // Upload image to uDrop to be able to then use the url for it in the ephemeral message for the user
    if (scorecardImage != null) {
      try {
        const authFormData = new FormData();
        authFormData.append('key1', process.env.UDROP_KEY1);
        authFormData.append('key2', process.env.UDROP_KEY2);

        const authResult = await got.post(`${uDropBaseUrl}api/v2/authorize`, { responseType: 'json', resolveBodyOnly: true, body: authFormData });

        if (authResult._status.toLowerCase() === 'success') {
          const imageUploadFormData = new FormData();
          imageUploadFormData.append('access_token', authResult.data.access_token);
          imageUploadFormData.append('account_id', authResult.data.account_id);
          imageUploadFormData.append('upload_file', scorecardImage, { filename: `${uuidv4()}.jpg` });

          const imageUploadResult = await got.post(`${uDropBaseUrl}api/v2/file/upload`, { responseType: 'json', resolveBodyOnly: true, body: imageUploadFormData });

          if (imageUploadResult._status.toLowerCase() === 'success') {
            // Send ephemeral to user
            await sendEphemeralToUser(client, userId, channelId, `Scorecard for <@${userIdToShow}>! :sunglasses:`,
              [{
                color: attachmentsColor,
                blocks: [
                  {
                    type: 'image',
                    image_url: imageUploadResult.data[0].url.replace(uDropBaseUrl, `${uDropBaseUrl}file/`), // Quick and dirty way to get direct link since uDrop doesn't return direct links in response :(
                    alt_text: 'Scorecard image'
                  }
                ]
              }]);
          }
          else {
            throw ('uDrop image upload was not successful.');
          }
        }
        else {
          throw ('uDrop auth was not successful.');
        }
      }
      catch (error) {
        console.error(`There was an error handling scorecard command. ${error}`);
        await sendEphemeralToUser(client, userId, channelId, userErrorMessage);        
      }
    }
  }
}

app.command('/karrotawards', async ({ ack, body, client }) => {
  // As per spec, acknowledge first
  await ack();

  const requester = `${body.user_id}:${body.user_name}`;

  // Flow to show user private message about capabilities of this application
  if (body.text.toLowerCase().trim() === 'help') {
    console.log(`Got help request from [${requester}].`);
    await handleHelpCommand(client, body.user_id, body.channel_id);
  }
  // Main flow to give someone an award
  else if (body.text.trim() === '') {
    console.log(`Got award request from [${requester}].`);
    await handleAwardRequestCommand(client, body.user_id, body.channel_id, body.trigger_id);
  }
  // Flow to generate full scorecard list, convert it to HTML table, then image and then send it back to the channel. Show top env.LEADERBOARD_NUMBER_OF_USERS users
  else if (body.text.toLowerCase().trim() === 'leaderboard') {
    console.log(`Got leaderboard request from [${requester}].`);
    await handleLeaderboardCommand(client, body.user_id, body.channel_id, body.trigger_id);
  }
  // Flow to show stats for just one user specified in the request
  else if (body.text.toLowerCase().includes('scorecard')) {
    console.log(`Got scorecard request from [${requester}].`);
    await handleScorecardCommand(client, body.text, body.user_id, body.channel_id);
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

    return;
  }
  else {
    await ack();
  }

  await sendEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId, workingOnItMessage);

  const mongoClient = createMongoClient(mongoDbUri);
  let message = '';

  try {
    await mongoClient.connect();

    // Update scorecards for selected users
    const scoreCardsCollection = mongoClient.db().collection("ScoreCards");
    const currentUserStats = await scoreCardsCollection.find({ $or: viewSubmissionPayload.selectedUsers.map(userId => { return { userId: userId }; }) }).toArray();
    const updatedUserStats = [];

    // Go through all selected users in the modal. If user has scorecard already then update corresponding awards counters. Otherwise create new user scorecard and set counters for awards to 1
    viewSubmissionPayload.selectedUsers.forEach(userId => {
      let updatedUserStat = currentUserStats.filter(item => { return item.userId === userId }).pop();

      if (updatedUserStat == null) { updatedUserStat = { userId: userId, awards: [] }; }

      viewSubmissionPayload.selectedAwards.forEach(submittedAward => {
        const currentUserAward = updatedUserStat.awards.filter(award => { return award.awardId.toString() === submittedAward.id }).pop();
        currentUserAward == null ? updatedUserStat.awards.push({ awardId: ObjectId(submittedAward.id), count: 1 }) : currentUserAward.count++;
      });

      updatedUserStats.push(updatedUserStat);
    });

    // Save updated user scorecards in one bulk operation
    const bulkDBUpsertOperation = scoreCardsCollection.initializeUnorderedBulkOp();

    updatedUserStats.forEach(updatedUserStat => {
      bulkDBUpsertOperation.find({ userId: updatedUserStat.userId }).upsert().replaceOne({
        userId: updatedUserStat.userId,
        awards: updatedUserStat.awards
      });
    });

    await bulkDBUpsertOperation.execute();

    // Get random message template from the DB. First we get just ids, because we could potentially have many of these with a lot of text, so we don't want to load all of that
    const messageTemplatesCollection = mongoClient.db().collection("MessageTemplates");
    const messageTemplateIds = await messageTemplatesCollection.find().project({ _id: 1 }).toArray();

    if (Object.entries(messageTemplateIds).length === 0) {
      message = defaultMessageTemplate; // Don't want to fail here if there is no templates in the DB
    }
    else {
      // We take random id out of the list and then fetch the actual text only for that message
      const item = await messageTemplatesCollection.findOne({ _id: messageTemplateIds[Math.floor(Math.random() * messageTemplateIds.length)]._id });
      message = item.text;
    }
  }
  catch (error) {
    console.error(`There was an error updating scorecards or getting message template from the DB. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId, userErrorMessage);
    return;
  }
  finally {
    await mongoClient.close();
  }

  // Finally after we saved the scorecards and got the message template, we can now update it with the values we got from submission and send that to the channel
  try {
    message = message.replace(/{sender}/gi, `<@${viewSubmissionPayload.userId}>`)
      .replace(/{receiver}/gi, viewSubmissionPayload.selectedUsers.map(user => { return `<@${user}>`; }).toString().replace(/,/gi, ', ')).replace(/,\s([^,]+)$/, ' and $1')
      .replace(/{award}/gi, viewSubmissionPayload.selectedAwards.map(award => { return award['emoji']; }).toString().replace(/,/gi, ', ')).replace(/,\s([^,]+)$/, ' and $1')
      .replace(/{attachmentText}/gi, viewSubmissionPayload.attachmentText == null ? '' : viewSubmissionPayload.attachmentText);

    await client.chat.postMessage({
      channel: viewSubmissionPayload.channelId,
      text: message
    });
  }
  catch (error) {
    console.error(`There was an error generating and posting final message to the channel about assigned awards. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.userId, viewSubmissionPayload.channelId, userErrorMessage);
  }
});

// Main -> start the Bolt app.
(async () => {
  await app.start(process.env.APP_PORT);
  console.log('KarrotAwards -> ⚡️ Bolt app is running!');
})();