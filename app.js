// TODO: Add logging to file
// TODO: create proper summaries and annotations for functions/classes
// TODO: Refactor all User into just user
// TODO: refactor all variables from being var_name to varName
// TODO: Refactor all IDs into Ids
// TODO: Think how to get rid of the magical strings like 'awards-select-block' in the code and have them in one place. Maybe put them as consts in the Modal class
// TODO: Add proper logging for all outgoing/incoming requests/results with DateTime stamps
// TODO: Somehow modularize the app? so that helper methods are in other file? Also maybe app event listeners could be also in a different file(s)?
// TODO: Add throtthling, so that users don't DDOS /karrotawards leaderboard or /karrotawards scorecard @user
// TODO: Add logic to also randomly pick announcement messages for scorecard and stats
// TODO: Add logic to calculate final score based on number of awards and their weight and show it in the final table, also sort users and show leaderboard based on that calculated number
// TODO: Add to help message that scorecard command will show data for the first user in list, and it will show the data in private message

// Configuration.
require('dotenv').config();
// 3rd party packages to make our life easier with images download and HTML to image generation.
const got = require('got');
const nodeHtmlToImage = require('node-html-to-image');
// Atlas MongoDB.
const { MongoClient, ObjectId } = require("mongodb");
// Slack related packages.
const { App } = require("@slack/bolt");
const { WebClient } = require('@slack/web-api');
// Custom built classes to support this application.
const { Modal } = require("./entities/modal.js");
const { ViewSubmissionPayload } = require("./entities/viewSubmissionPayload.js");
const { HtmlTable } = require('./entities/htmlTable.js');

// Connection string to Atlas MongoDB, will be used to instantiate clients to read/write data.
const mongoDbUri = `mongodb+srv://${process.env.MONGODB_USER_NAME}:${process.env.MONGODB_USER_PASSWORD}@${process.env.MONGODB_CLUSTER_URL}/${process.env.MONGODB_NAME}?retryWrites=true&w=majority`;

// Initialize the Bolt app with bot token and signing secret.
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

/**
 * Function to instantiate the new client for Atlas MongoDB to access data in it.
 * @param {String} uri Uri connection string for the Atlas MongoDB.
 */
function createMongoClient(uri) {
  return new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
}

/**
 * Function to send ephemeral message to the user.
 * @param {WebClient} client Slack Bolt WebClient that allows to use Slack WebApi methods.
 * @param {String} userId Slack user identifier.
 * @param {String} channelId Slack channel identifier.
 * @param {String} text Text that will be sent to the user.
 */
async function sendEphemeralToUser(client, userId, channelId, text, attachments = null) { // TODO: Do we need it to be async?
  try {
    const ephemeralResult = await client.chat.postEphemeral({
      text: text,
      user: userId,
      channel: channelId,
      attachments: attachments
    });

    //console.log(ephemeralResult);
  }
  catch (error) {
    console.error(`There was an error sending ephemeral message back to the User. ${error}`);
  }
}

/**
 * Function to validate user input provided through the modal. It contains custom validations that were not included in the default modal input fields behavior.
 * @param {ViewSubmissionPayload} viewSubmissionPayload Object containing relevant data about user input in the awards modal.
 */
function validateModalSubmission(viewSubmissionPayload) {
  const errors = {};

  // Users field validation
  if (viewSubmissionPayload.selected_users.includes(viewSubmissionPayload.user_id)) {
    errors['user-select-block'] = 'Sorry, please remove yourself from the list :)';
  }
  else if (Object.entries(viewSubmissionPayload.selected_users).length > process.env.MAX_NUMBER_OF_SELECTED_USERS) {
    errors['user-select-block'] = `Maximum number of users to select is ${process.env.MAX_NUMBER_OF_SELECTED_USERS}.`;
  }

  // Awards field validation
  if (Object.entries(viewSubmissionPayload.selected_awards).length > process.env.MAX_NUMBER_OF_SELECTED_AWARDS) {
    errors['awards-select-block'] = `Maximum number of awards to select is ${process.env.MAX_NUMBER_OF_SELECTED_AWARDS}.`;
  }

  return errors;
}

// TODO: Handle here different inputs like /karrotawards award, /karrotawards leaderboard, /karrotawards scorecard @user
// TODO: Also have these setup in Slack and have help function available
// /karrotawards command handler
app.command('/karrotawards', async ({ ack, body, client }) => {
  // As per spec, acknowledge right away
  await ack();

  const commandRequester = `${body.user_id}:${body.user_name}`;

  // TODO: Create help message to send to user
  // Flow to show user private message about capabilities of this application
  if (body.text.toLowerCase() === 'help') {
    await sendEphemeralToUser(client, body.user_id, body.channel_id, 'How to use KarrotAwards:',
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
  // Main flow to give someone an award
  else if (body.text === '') {
    console.log(`${new Date()} -> Got request from [${commandRequester}] to assign an award.`);

    // Create new MongoDB client
    const mongoClient = createMongoClient(mongoDbUri);

    // Will be used to pass data to the Slack modal
    const mappedAwards = [];

    // Try getting rewards from the DB
    try {
      await mongoClient.connect();
      const dbAwards = await mongoClient.db().collection("Awards").find().toArray();
      dbAwards.forEach(dbAward => { mappedAwards.push({ text: `${dbAward.userText} ${dbAward.text}`, value: `award-select-value-${dbAward._id}` }); });
    }
    catch (error) {
      console.error(`There was an error getting awards list from the DB. Sending ephemeral to User and returning. ${error}`);
      await sendEphemeralToUser(client, body.user_id, body.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
      return;
    }
    finally {
      await mongoClient.close();
    }

    if (Object.entries(mappedAwards).length === 0) {
      console.log('No awards available to create the modal! Sending ephemeral to User and returning.');
      await sendEphemeralToUser(client, body.user_id, body.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
      return;
    }

    try {
      const modal = new Modal('KarrotAwards', 'Submit', 'Cancel', JSON.stringify({ channel_id: body.channel_id }));
      modal.multi_user_selection('user-select-block', 'Who is the lucky person?', `Select up to ${process.env.MAX_NUMBER_OF_SELECTED_USERS} users`, 'user-select-action', false);
      modal.multi_items_selection('awards-select-block', 'What award are they getting?', `Select up to ${process.env.MAX_NUMBER_OF_SELECTED_AWARDS} awards`, 'award-select-action', mappedAwards, false);
      modal.text_input('Would you like to say something special to them?', 'text-input-action', 'attachment-text-input-block', true);

      await client.views.open({
        trigger_id: body.trigger_id,
        view: modal
      });
    }
    catch (error) {
      console.error(`There was an error creating the modal and opening it. Sending ephemeral to User. ${error}`);
      await sendEphemeralToUser(client, body.user_id, body.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
    }
  }
  // Flow to generate full scorecard list, convert it to HTML table, then image and then send it back to the channel. Show top env.LEADERBOARD_NUMBER_OF_USERS users
  else if (body.text.toLowerCase() === 'leaderboard') {
    console.log(`${new Date()} -> Got request from [${commandRequester}] to display scorecard.`);

    await sendEphemeralToUser(client, body.user_id, body.channel_id, ':man-biking: Please wait, I\'m working hard on your request! :woman-biking:'); // TODO: See if this is actually right way to do this

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
      console.error(`There was an error getting user stats and/or awards from the DB. Sending ephemeral to User and returning. ${error}`);
      await sendEphemeralToUser(client, body.user_id, body.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
      return;
    }
    finally {
      mongoClient.close();
    }

    // TODO: Somehow track and do not display deleted/inactive/locked users, possibly even have a process to remove them from the scorecard table in DB. Need to combine this with the users.list to see which accounts have been deleted
    // Get user names. Use Promise.all to get them all at once. Use client.users.profile.get and remember that method doesn't return user ID as a result. 
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
      console.error(`There was an error getting emojis from Slack. Sending ephemeral to User. ${error}`);
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
  // Flow to show stats for just one user specified in the request
  else if (body.text.toLowerCase().includes('scorecard')) {
    console.log(`${new Date()} -> Got request from [${commandRequester}] to display awards for a single user.`);

    // Parse message and get Id of the first user encountered
    let userIdToShow = (body.text.match(/<@[\d\w]+\|/g) || []).pop();

    if (userIdToShow == null) {
      await sendEphemeralToUser(client, body.user_id, body.channel_id, 'You didn\'t specify which user scorecard you would like to see. Please try again.'); // TODO: looks like it is working without await too, maybe can just do it without since at this point we don't care about anything except sending this message to user
    }
    else {
      userIdToShow = userIdToShow.substr(2, userIdToShow.length - 3);
      console.log(`Getting scorecard for the user id [${userIdToShow}].`);
      // TODO: Generate image and send back to the user with ephemeral.
    }
  }
});

// Handle a view_submission event
app.view('modal_submission', async ({ ack, body, view, client }) => {
  // Get all data relevant to us
  const viewSubmissionPayload = new ViewSubmissionPayload(body, view);

  const errors = validateModalSubmission(viewSubmissionPayload);

  // Acknowledge the view_submission event
  if (Object.entries(errors).length > 0) {
    await ack({
      response_action: 'errors',
      errors: errors
    });

    console.log('User input was not valid. Returning.');
    return;
  }
  else {
    await ack();
  }

  await sendEphemeralToUser(client, viewSubmissionPayload.user_id, viewSubmissionPayload.channel_id, ':man-biking: Please wait, I\'m working hard on your request! :woman-biking:'); // TODO: See if this is actually right way to do this

  // Create new MongoDB client
  let mongoClient = createMongoClient(mongoDbUri);

  // Get message template from DB
  let message = '';

  try {
    await mongoClient.connect();
    const messageTemplatesCollection = mongoClient.db().collection("MessageTemplates");
    const messageTemplateIds = await messageTemplatesCollection.find().project({ _id: 1 }).toArray();

    if (Object.entries(messageTemplateIds).length === 0) {
      console.log('No message templates available! Sending ephemeral to User and returning.');
      await sendEphemeralToUser(client, viewSubmissionPayload.user_id, viewSubmissionPayload.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
      return;
    }

    const item = await messageTemplatesCollection.findOne({ _id: messageTemplateIds[Math.floor(Math.random() * messageTemplateIds.length)]._id });
    message = item.text;
  }
  catch (error) {
    console.error(`There was an error getting message template from the DB. Sending ephemeral to User and returning. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.user_id, viewSubmissionPayload.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
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
    const currentUserStats = await scoreCardsCollection.find({ $or: viewSubmissionPayload.selected_users.map(userId => { return { userId: userId }; }) }).toArray();

    const updatedUserStats = [];

    viewSubmissionPayload.selected_users.forEach(userId => {
      let currentUserStat = currentUserStats.filter(item => { return item.userId === userId }).pop();

      if (currentUserStat == null) { currentUserStat = { userId: userId, awards: [] }; }

      viewSubmissionPayload.selected_awards.forEach(submittedAward => {
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
    console.error(`There was an error saving stats to the DB. Sending ephemeral to User and returning. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.user_id, viewSubmissionPayload.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
    return;
  }
  finally {
    mongoClient.close();
  }

  // Send message back to the channel
  try {
    // TODO: Add "and" instead of the "," if multiple users, awards are present
    message = message.replace(/{sender}/gi, `<@${viewSubmissionPayload.user_id}>`);
    message = message.replace(/{receiver}/gi, viewSubmissionPayload.selected_users.map(user => { return `<@${user}>`; }).toString().replace(/,/gi, ', '));
    message = message.replace(/{award}/gi, viewSubmissionPayload.selected_awards.map(award => { return award['emoji']; }).toString().replace(/,/gi, ', '));
    message = message.replace(/{attachmentText}/gi, viewSubmissionPayload.attachmentText == null ? '' : viewSubmissionPayload.attachmentText);

    await client.chat.postMessage({
      channel: viewSubmissionPayload.channel_id,
      text: message
    });
  }
  catch (error) {
    console.error(`There was an error generating and posting final message to the channel. Sending ephemeral to User. ${error}`);
    await sendEphemeralToUser(client, viewSubmissionPayload.user_id, viewSubmissionPayload.channel_id, 'Something went wrong :cry: Please try again later :rewind:');
  }
});

// Main -> start the Bolt app.
(async () => {
  await app.start(process.env.APP_PORT);
  console.log('KarrotAwards -> ⚡️ Bolt app is running!');
})();