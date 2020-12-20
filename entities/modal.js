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

module.exports = {
  Modal
};