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

  multi_user_selection(blockId, labelText, placeholderText, actionId, optional) {
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

  multi_items_selection(blockId, labelText, placeholderText, actionId, items, optional) {
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

  text_input(label_text, action_id, blockId, optional) {
    this.blocks.push({
      type: 'input',
      block_id: blockId,
      optional: optional,
      element: { type: 'plain_text_input', action_id: action_id },
      label: { type: 'plain_text', text: label_text }
    });
  }
}

const selectedUsersBlockId = 'user-select-block';
const selectedAwardsBlockId = 'awards-select-block';

class AwardsModalSubmissionPayload {
  constructor(body, view) {
      this.selectedUsers = view.state.values[selectedUsersBlockId]['user-select-action'].selected_users;
      this.selectedAwards = view.state.values[selectedAwardsBlockId]['award-select-action'].selected_options.map(option => { return { text: option.text.text.split(' ').slice(0, -1).join(' '), emoji: option.text.text.split(' ').pop(), id: option.value.split('-').pop() }; });
      this.attachmentText = view.state.values['attachment-text-input-block']['text-input-action'].value;
      this.channelId = JSON.parse(view.private_metadata).channelId;
      this.userId = body['user']['id'];
  }
}

class ModalHelper {
  static generateAwardsModal(channelId, awards) {
    const modal = new Modal('KarrotAwards', 'Submit', 'Cancel', JSON.stringify({ channelId: channelId }));
    modal.multi_user_selection(selectedUsersBlockId, 'Who is the lucky person?', `Select up to ${process.env.MAX_NUMBER_OF_SELECTED_USERS} users`, 'user-select-action', false);
    modal.multi_items_selection(selectedAwardsBlockId, 'What award are they getting?', `Select up to ${process.env.MAX_NUMBER_OF_SELECTED_AWARDS} awards`, 'award-select-action', awards, false);
    modal.text_input('Would you like to say something special to them?', 'text-input-action', 'attachment-text-input-block', true);

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
      errors[selectedUsersBlockId] = `Maximum number of users to select is ${process.env.MAX_NUMBER_OF_SELECTED_USERS}.`;
    }

    if (Object.entries(awardsModalSubmissionPayload.selectedAwards).length > process.env.MAX_NUMBER_OF_SELECTED_AWARDS) {
      errors[selectedAwardsBlockId] = `Maximum number of awards to select is ${process.env.MAX_NUMBER_OF_SELECTED_AWARDS}.`;
    }

    return errors;
  }
}

module.exports = {
  ModalHelper, AwardsModalSubmissionPayload
};