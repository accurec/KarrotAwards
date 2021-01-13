// TODO: Use OpenAI API GPT3 to generate messages instead of having them in the DB. Or maybe even mix both? Need to do some research. https://beta.openai.com/ 
// TODO: For leaderboard also have different random messages like we have for the award announcements.
// TODO: Instead of using uDrop service to host images, better option would be Amazon S3? https://devcenter.heroku.com/articles/s3-upload-node

require('dotenv').config();
const got = require('got');
const nodeHtmlToImage = require('node-html-to-image');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ObjectId } = require("mongodb");
const { App, RespondFn } = require("@slack/bolt");
const { WebClient, LogLevel } = require("@slack/web-api");
const { ModalHelper, AwardsModalSubmissionPayload } = require("./helpers/modal");
const { HtmlTableHelper } = require('./helpers/htmlTable');

const mongoDbUri = `mongodb+srv://${process.env.MONGODB_USER_NAME}:${process.env.MONGODB_USER_PASSWORD}@${process.env.MONGODB_CLUSTER_URL}/${process.env.MONGODB_NAME}?retryWrites=true&w=majority`;
const uDropBaseUrl = 'https://www.udrop.com/';
const defaultMessageTemplate = '{sender} said "{attachmentText}" and awarded {receiver} with {award}.';
const userWorkingOnItMessage = ':man-biking: Working on it, please wait. :woman-biking:';
const userErrorMessage = 'Something went wrong :cry: Please try again later and/or contact Administrator :rewind:';

// Initialize the Bolt app with bot token and signing secret.
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.INFO
});

/**
 * Function to instantiate the new client for Atlas MongoDB to access data in it.
 * @return {MongoClient} MongoDB client instance.
 */
function createMongoDBClient() {
  try {
    return new MongoClient(mongoDbUri, { useNewUrlParser: true, useUnifiedTopology: true });
  }
  catch (error) {
    console.error(`There was an error creating mongo client for uri [${mongoDbUri}]. ${error}`);
  }
}

/**
 * Function to generate HTML table image with user score and awards.
 * @param {WebClient} client Slack WebApi client to make calls to get some additional info.
 * @param {Number} numberOfUsers Number of users to show in the table image.
 * @param {String} targetUserId User id for which we need to generate scorecard image. If set to null then will do top X users as defined in config.
 * @return {Promise<Buffer>} Image buffer data.
 */
async function generateScorecardImage(client, numberOfUsers, targetUserId) {
  const mongoClient = createMongoDBClient();

  if (mongoClient == null) {
    return;
  }

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

  // Get all custom emojis from Slack
  let slackEmojisLinks = {};

  try {
    slackEmojisLinks = (await client.emoji.list()).emoji;
  }
  catch (error) {
    console.error(`There was an error getting custom emojis list from Slack. ${error}`);
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
    console.error('Somehow ended up not having any awards in the list :(');
    return;
  }

  // Sort the list so that the awards always show up in the same order - for consistent user experience
  awards.sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text));

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

    userStat.awardsCount.push(parseFloat(totalUserScore.toFixed(2))); // Either have 2 decimals if there is value, or none if number is integer
  });

  try {
    const scorecardImage = await nodeHtmlToImage({
      html: HtmlTableHelper.generateHTMLTable(awards, (targetUserId == null ? userStats.sort((a, b) => b.awardsCount.slice(-1) - a.awardsCount.slice(-1)).slice(0, numberOfUsers) : userStats)).contents,
      content: awards.reduce((current, award) => {
        current[award._id] = `data:image/jpeg;base64,${award.urlContents.toString('base64')}`;
        return current;
      }, {}), // TODO: image/jpeg seems to be working fine for all original formats such as png, gif, jpeg, jpg. Not sure if I need to bother converting it according to the original extension 
      beforeScreenshot: async (page) => {
        const tableSize = await page.$eval('#mainTable', el => [el.clientWidth, el.clientHeight]);
        await page.addStyleTag({ content: `body {width:${tableSize[0]}px;height:${tableSize[1]}px;}` }) // This is needed so that the screenshot is properly sized to the size of the table
      },
      puppeteerArgs: { args: ["--no-sandbox"] }
    });

    return scorecardImage;
  }
  catch (error) {
    console.error(`There was an error in the last step of generating the image. ${error}`);
    return;
  }
}

/**
 * Function to upload image to uDrop server and return url for its location.
 * @param {Buffer} image Image buffer that will be used to upload to uDrop server.
 * @return {Promise<String>} uDrop external url for the image.
 */
async function uploadImageToUDrop(image) {
  try {
    const authFormData = new FormData();
    authFormData.append('key1', process.env.UDROP_KEY1);
    authFormData.append('key2', process.env.UDROP_KEY2);

    const authResult = await got.post(`${uDropBaseUrl}api/v2/authorize`, { responseType: 'json', resolveBodyOnly: true, body: authFormData });

    if (authResult._status.toLowerCase() === 'success') {
      const imageUploadFormData = new FormData();
      imageUploadFormData.append('access_token', authResult.data.access_token);
      imageUploadFormData.append('account_id', authResult.data.account_id);
      imageUploadFormData.append('upload_file', image, { filename: `${uuidv4()}.jpg` });

      const imageUploadResult = await got.post(`${uDropBaseUrl}api/v2/file/upload`, { responseType: 'json', resolveBodyOnly: true, body: imageUploadFormData });

      if (imageUploadResult._status.toLowerCase() === 'success') {
        return imageUploadResult.data[0].url.replace(uDropBaseUrl, `${uDropBaseUrl}file/`);
      }
      else {
        throw (imageUploadResult.response);
      }
    }
    else {
      throw (authResult.response);
    }
  }
  catch (error) {
    console.error(`There was an error uploading image to uDrop. ${error}`);
  }
}

/**
 * Function to send back help message.
 * @param {RespondFn} respond Slack API respond function attached to the current context.
 */
async function handleHelpCommand(respond) {
  // Only display the message if operation takes longer than expected
  var workingOnItMessageInterval = setTimeout(async () => { await respond(userWorkingOnItMessage); }, process.env.WORK_NOTIFICATION_TIMEOUT_INTERVAL_MILLISECONDS);

  try {
    await respond({
      attachments: [
        {
          color: '#de5c00',
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: 'Help:'
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '- To give someone one or multiple awards you can use \`/karrotawards\`.\n*Fun fact:* every award has its own score, but I\'m not going to tell you how much each award is worth :stuck_out_tongue_winking_eye:'
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `- To see who is leading the awards race you can use \`/karrotawards leaderboard\`. It will display top ${process.env.LEADERBOARD_DEFAULT_NUMBER_OF_USERS} performers to the channel by default! You can also specify the number of users. For example, \`/karrotawards leaderboard ${process.env.LEADERBOARD_MAX_NUMBER_OF_USERS}\`. Allowed values are between 1 and ${process.env.LEADERBOARD_MAX_NUMBER_OF_USERS}.`
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '- Curious to see what awards a specific user won so far? Use \`/karrotawards scorecard @someone\` and you will get a private message to see that user\'s scorecard.\n*Note:* If you mention multiple users, you will only see the first user\'s scorecard.'
              }
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*P.S.* Are you a creative writer? :upside_down_face: You can contribute to this project! To get more details please feel free to contact \`${process.env.CONTRIBUTE_EMAIL_ADDR}\`! :slightly_smiling_face:`
              }
            }
          ]
        }]
    });
  }
  catch (error) {
    console.error(`There was an error sending help message. ${error}`);
  }
  finally {
    clearTimeout(workingOnItMessageInterval);
  }
}

/**
 * Function get awards data from the DB and open the modal for the user.
 * @param {WebClient} client Slack WebApi client that is going to be used to open modal.
 * @param {String} responseUrl This will be included in the modal metadata so that when user submits it we can post message to where it originated from.
 * @param {String} triggerId In case everything is fine and the modal is ready, trigger id is needed to open the modal for the user.
 * @param {RespondFn} respond Slack API respond function attached to the current context.
 * @param {String} userId Id of the user that initiated the command.
 * @param {String} channelId Channel id where the command was called.
 */
async function handleAwardRequestCommand(client, responseUrl, triggerId, respond, userId, channelId) {
  // Only display the message if operation takes longer than expected
  var workingOnItMessageInterval = setTimeout(async () => { await respond(userWorkingOnItMessage); }, process.env.WORK_NOTIFICATION_TIMEOUT_INTERVAL_MILLISECONDS);

  const mongoClient = createMongoDBClient();

  if (mongoClient == null) {
    clearTimeout(workingOnItMessageInterval);
    await respond(userErrorMessage);
    return;
  }

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
    clearTimeout(workingOnItMessageInterval);
    await respond(userErrorMessage);
    return;
  }
  finally {
    await mongoClient.close();
  }

  try {
    // Sort the awards list so that the awards always show up in the same order - for consistent user experience
    const modalOpenViewResult = await client.views.open({
      trigger_id: triggerId,
      view: ModalHelper.generateAwardsModal(responseUrl, dbAwards.sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text)).map(dbAward => { return { text: `${dbAward.userText} ${dbAward.text}`, value: `award-select-value-${dbAward._id}` }; }))
    });

    console.info(`Opened awards modal [${userId}:${channelId}:${modalOpenViewResult.view.id}].`);
  }
  catch (error) {
    console.error(`There was an error creating the modal and sending it to the user. ${error}`);
    await respond(userErrorMessage);
  }
  finally {
    clearTimeout(workingOnItMessageInterval);
  }
}

/**
 * Function to generate and upload image with leaderboard, then send the message to the channel.
 * @param {String} userId User on whos request command is being executed.
 * @param {WebClient} client Slack WebApi client to make calls to get some additional info.
 * @param {RespondFn} respond Slack API respond function attached to the current context.
 */
async function handleLeaderboardCommand(userId, commandText, client, respond) {
  // Only display the message if operation takes longer than expected
  var workingOnItMessageInterval = setTimeout(async () => { await respond(userWorkingOnItMessage); }, process.env.WORK_NOTIFICATION_TIMEOUT_INTERVAL_MILLISECONDS);

  let numberOfUsersToDisplay;
  const regExp = new RegExp(`^leaderboard \\d{1,${process.env.LEADERBOARD_MAX_NUMBER_OF_USERS.length}}$`, 'i');

  if (commandText.toLowerCase().trim() === 'leaderboard') {
    numberOfUsersToDisplay = parseInt(process.env.LEADERBOARD_DEFAULT_NUMBER_OF_USERS);
  }
  else if (regExp.test(commandText) !== true) {
    clearTimeout(workingOnItMessageInterval);
    await respond(`Sorry, the command was not in a correct format or the number you have entered is outside of allowed bounds. Please refer to \`/karrotawards help\` command for the correct use.`);
    return;
  }
  else {
    numberOfUsersToDisplay = parseInt(commandText.split(' ')[1]);
  }

  if (numberOfUsersToDisplay < 1 || numberOfUsersToDisplay > process.env.LEADERBOARD_MAX_NUMBER_OF_USERS) {
    clearTimeout(workingOnItMessageInterval);
    await respond(`Sorry, the allowed range of leaderboard users is between 1 and ${process.env.LEADERBOARD_MAX_NUMBER_OF_USERS}.`);
    return;
  }

  const scorecardImage = await generateScorecardImage(client, numberOfUsersToDisplay, null);

  if (scorecardImage == null) {
    clearTimeout(workingOnItMessageInterval);
    await respond(userErrorMessage);
    return;
  }

  const imageUDropUrl = await uploadImageToUDrop(scorecardImage, respond);

  if (imageUDropUrl == null) {
    clearTimeout(workingOnItMessageInterval);
    await respond(userErrorMessage);
    return;
  }

  try {
    await respond({
      response_type: 'in_channel',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:sunglasses: *Requested by the fabulous <@${userId}>! KarrotAwards "Top ${numberOfUsersToDisplay}" leaderboard!* :fireworks:`
          }
        },
        {
          type: 'image',
          image_url: imageUDropUrl,
          alt_text: 'Leaderboard image'
        }
      ]
    });
  }
  catch (error) {
    console.error(`There was an error sending leaderboard message. ${error}`);
    await respond(userErrorMessage);
  }
  finally {
    clearTimeout(workingOnItMessageInterval);
  }
}

/**
 * Function to generate and upload image with scorecard for a specofoc user, then send the message to requester as ephemeral.
 * @param {WebClient} client Slack WebApi client to make calls to get some additional info.
 * @param {String} commandText Text of the command - to get user id from it to generate scorecard for it.
 * @param {RespondFn} respond Slack API respond function attached to the current context.
 */
async function handleScorecardCommand(client, commandText, respond) {
  // Parse message and get Id of the first user encountered
  let userIdToShow = (commandText.match(/<@[\d\w]+\|/g) || []).pop();

  if (userIdToShow == null) {
    await respond('You didn\'t specify which user scorecard you would like to see. Please try again.');
  }
  else {
    // Only display the message if operation takes longer than expected
    var workingOnItMessageInterval = setTimeout(async () => { await respond(userWorkingOnItMessage); }, process.env.WORK_NOTIFICATION_TIMEOUT_INTERVAL_MILLISECONDS);

    userIdToShow = userIdToShow.substr(2, userIdToShow.length - 3);
    const scorecardImage = await generateScorecardImage(client, 1, userIdToShow);

    if (scorecardImage == null) {
      clearTimeout(workingOnItMessageInterval);
      respond(userErrorMessage);
      return;
    }

    const imageUDropUrl = await uploadImageToUDrop(scorecardImage, respond);

    if (imageUDropUrl == null) {
      clearTimeout(workingOnItMessageInterval);
      respond(userErrorMessage);
      return;
    }

    try {
      await respond({
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Scorecard for <@${userIdToShow}>!* :sunglasses:`
            }
          },
          {
            type: 'image',
            image_url: imageUDropUrl,
            alt_text: 'Scorecard image'
          }
        ]
      });
    }
    catch (error) {
      console.error(`There was an error sending scorecard message. ${error}`);
      await respond(userErrorMessage);
    }
    finally {
      clearTimeout(workingOnItMessageInterval);
    }
  }
}

app.command('/karrotawards', async ({ ack, body, respond, client }) => {
  // As per spec, acknowledge first
  await ack();

  console.info(`Got command [${body.user_id}:${body.user_name};${body.channel_id}:${body.channel_name};${body.trigger_id};${body.text}].`);

  // Flow to show user private message about capabilities of this application
  if (body.text.toLowerCase().trim() === 'help') {
    await handleHelpCommand(respond);
  }
  // Main flow to give someone an award
  else if (body.text.trim() === '') {
    await handleAwardRequestCommand(client, body.response_url, body.trigger_id, respond, body.user_id, body.channel_id);
  }
  // Flow to generate full scorecard list, convert it to HTML table, then image and then send it back to the channel
  else if (body.text.toLowerCase().includes('leaderboard')) {
    await handleLeaderboardCommand(body.user_id, body.text, client, respond);
  }
  // Flow to show stats for just one user specified in the request
  else if (body.text.toLowerCase().includes('scorecard')) {
    await handleScorecardCommand(client, body.text, respond);
  }
});

app.view({ callback_id: 'karrotawards_modal_callback_id', type: 'view_closed' }, async ({ ack, body, view }) => {
  ack();

  console.info(`The awards modal was closed [${body.user.id}:${body.user.name};${view.id};${body.is_cleared}].`);
});

app.view({ callback_id: 'karrotawards_modal_callback_id', type: 'view_submission' }, async ({ ack, body, view }) => {
  const viewSubmissionPayload = new AwardsModalSubmissionPayload(body, view);

  console.info(`Got award submission payload [${JSON.stringify(viewSubmissionPayload)}].`);

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

  // Only display the message if operation takes longer than expected
  var workingOnItMessageInterval = setTimeout(async () => { await got.post(viewSubmissionPayload.responseUrl, { body: JSON.stringify({ text: userWorkingOnItMessage }) }); }, process.env.WORK_NOTIFICATION_TIMEOUT_INTERVAL_MILLISECONDS);

  const mongoClient = createMongoDBClient();

  if (mongoClient == null) {
    clearTimeout(workingOnItMessageInterval);
    await got.post(viewSubmissionPayload.responseUrl, { body: JSON.stringify({ text: userErrorMessage }) });
    return;
  }

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
    clearTimeout(workingOnItMessageInterval);
    await got.post(viewSubmissionPayload.responseUrl, { body: JSON.stringify({ text: userErrorMessage }) });
    return;
  }
  finally {
    await mongoClient.close();
  }

  // Finally after we saved the scorecards and got the message template, we can now update it with the values we got from submission and send that to the channel
  try {
    message = message.replace(/{sender}/gi, `<@${viewSubmissionPayload.userId}>`)
      .replace(/{receiver}/gi, viewSubmissionPayload.selectedUsers.map(user => { return `<@${user}>`; }).toString().replace(/,/gi, ', ').replace(/,\s([^,]+)$/, ' and $1'))
      .replace(/{award}/gi, viewSubmissionPayload.selectedAwards.map(award => { return award['emoji']; }).toString().replace(/,/gi, ', ').replace(/,\s([^,]+)$/, ' and $1'))
      .replace(/{attachmentText}/gi, viewSubmissionPayload.attachmentText == null ? '' : viewSubmissionPayload.attachmentText);

    await got.post(viewSubmissionPayload.responseUrl, {
      body: JSON.stringify({
        replace_original: true,
        delete_original: true,
        response_type: 'in_channel',
        text: `*${message}*`
      })
    });
  }
  catch (error) {
    console.error(`There was an error generating and posting final message to the channel about assigned awards. ${error}`);
    await got.post(viewSubmissionPayload.responseUrl, { body: JSON.stringify({ text: userErrorMessage }) });
  }
  finally {
    clearTimeout(workingOnItMessageInterval);
  }
});

// Main -> start the Bolt app.
(async () => {
  await app.start(process.env.PORT);
  console.info('KarrotAwards Bolt app started!');
})();