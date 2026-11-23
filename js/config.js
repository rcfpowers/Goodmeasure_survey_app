// Settings for this deployment. Edit these before publishing.
export const CONFIG = {
  // The Google Apps Script web app URL (ends in /exec). Leave empty to run in demo mode:
  // demo mode sends nothing and accepts links like ?s=staff&v=Demo%20Venue for testing.
  endpoint: 'https://script.google.com/macros/s/AKfycbyhCs_corN5JoZ74XQw63CszzvcKOsHcEVzIhTrXCktt53eXNKV-cQScpiUxDm64wFe/exec',

  // Shown wherever the surveys offer a private, confidential contact.
  privateContact: '[email or phone]',

  // Shown in the opening and closing screens.
  deleteBy: '[date]',

  // Used in owner question O46.
  localRadius: 30,

  // Offer guests the separate follow-up sign-up after the customer survey.
  followUp: true
};
