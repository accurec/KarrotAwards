class ViewSubmissionPayload {
    constructor(body, view) {
        this.selected_users = view.state.values['user-select-block']['user-select-action'].selected_users;
        this.selected_awards = view.state.values['awards-select-block']['award-select-action'].selected_options.map(option => { return { text: option.text.text.split(' ').slice(0, -1).join(' '), emoji: option.text.text.split(' ').pop(), id: option.value.split('-').pop() }; });
        this.attachmentText = view.state.values['attachment-text-input-block']['text-input-action'].value;
        this.channel_id = JSON.parse(view.private_metadata).channel_id;
        this.user_id = body['user']['id'];
    }
}

module.exports = {
    ViewSubmissionPayload
};