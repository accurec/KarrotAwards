// Const values that are used for modal generation and also validation response.
const selectedUsersBlockId = 'user-select-block';
const selectedAwardsBlockId = 'awards-select-block';

/**
 * Wrapper class to generate elements for Slack modal and modal itself.
 */
class Modal {
  constructor(titleText, submitText, cancelText, privateMetadata) {
    this.type = 'modal';
    this.callback_id = 'modal_submission';
    this.title = { type: 'plain_text', text: titleText };
    this.submit = { type: 'plain_text', text: submitText };
    this.close = { type: 'plain_text', text: cancelText };
    this.private_metadata = privateMetadata;
    this.blocks = [];
  }

  multiUserSelection(blockId, labelText, placeholderText, actionId, optional) {
    this.blocks.push({
      type: "input",
      block_id: blockId,
      optional: optional,
      element: {
        type: "multi_users_select",
        placeholder: {
          type: "plain_text",
          text: placeholderText
        },
        action_id: actionId
      },
      label: {
        type: "plain_text",
        text: labelText
      }
    })
  };

  multiItemsSelection(blockId, labelText, placeholderText, actionId, items, optional) {
    this.blocks.push({
      type: "input",
      block_id: blockId,
      optional: optional,
      element: {
        type: "multi_static_select",
        placeholder: {
          type: "plain_text",
          text: placeholderText
        },
        action_id: actionId,
        options: items.map(item => { return { text: { type: 'plain_text', text: item.text }, value: item.value } })
      },
      label: {
        type: "plain_text",
        text: labelText
      }
    })
  };

  textInput(label_text, action_id, blockId, optional) {
    this.blocks.push({
      type: 'input',
      block_id: blockId,
      optional: optional,
      element: { type: 'plain_text_input', action_id: action_id },
      label: { type: 'plain_text', text: label_text }
    });
  }
}

/**
 * Class to parse data from modal submission.
 */
class AwardsModalSubmissionPayload {
  constructor(body, view) {
      this.selectedUsers = view.state.values[selectedUsersBlockId]['user-select-action'].selected_users;
      this.selectedAwards = view.state.values[selectedAwardsBlockId]['award-select-action'].selected_options.map(option => { return { text: option.text.text.split(' ').slice(0, -1).join(' '), emoji: option.text.text.split(' ').pop(), id: option.value.split('-').pop() }; });
      this.attachmentText = view.state.values['attachment-text-input-block']['text-input-action'].value;
      this.responseUrl = JSON.parse(view.private_metadata).responseUrl;
      this.userId = body['user']['id'];
  }
}

/**
 * Class containing utility functions to deal with awards modal generation and submission data validation.
 */
class ModalHelper {
  /**
   * Function to generate modal object view to assign awards to users.
   * @param {String} responseUrl Response url that is going to be carried in the modal private metadata and used to send announcemet message once the modal is submitted.
   * @param {*} awards Object containing data about awards (emoji text, id, and user friendly text).
   */
  static generateAwardsModal(responseUrl, awards) {
    const modal = new Modal('KarrotAwards', 'Submit', 'Cancel', JSON.stringify({ responseUrl: responseUrl }));
    modal.multiUserSelection(selectedUsersBlockId, `Who is the lucky person? (maximum of ${process.env.MAX_NUMBER_OF_SELECTED_USERS})`, `Select user(s)`, 'user-select-action', false);
    modal.multiItemsSelection(selectedAwardsBlockId, `What award are they going to get? (maximum of ${process.env.MAX_NUMBER_OF_SELECTED_AWARDS})`, `Select award(s)`, 'award-select-action', awards, false);
    modal.textInput('Say something special to them!', 'text-input-action', 'attachment-text-input-block', false); // Decided to make mandatory for now

    return modal;
  }

  /**
   * Function to validate user input provided through the modal. It contains custom validations that were not included in the default modal input fields behavior.
   * @param {AwardsModalSubmissionPayload} awardsModalSubmissionPayload Object containing relevant data about user input in the awards modal.
   */
  static validateModalSubmissionPayload(awardsModalSubmissionPayload) {
    const errors = {};

    if (awardsModalSubmissionPayload.selectedUsers.includes(awardsModalSubmissionPayload.userId)) {
      errors[selectedUsersBlockId] = 'Sorry, please remove yourself from the list :)';
    }
    else if (Object.entries(awardsModalSubmissionPayload.selectedUsers).length > process.env.MAX_NUMBER_OF_SELECTED_USERS) {
      errors[selectedUsersBlockId] = `You can only select up to ${process.env.MAX_NUMBER_OF_SELECTED_USERS} users.`;
    }

    if (Object.entries(awardsModalSubmissionPayload.selectedAwards).length > process.env.MAX_NUMBER_OF_SELECTED_AWARDS) {
      errors[selectedAwardsBlockId] = `You can only select up to ${process.env.MAX_NUMBER_OF_SELECTED_AWARDS} awards.`;
    }

    return errors;
  }
}

module.exports = {
  ModalHelper, AwardsModalSubmissionPayload
};