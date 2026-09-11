const { getDefaultConfig } = require('expo/metro-config');
const { withAgentReactDevTools } = require('agent-react-devtools/metro');

const config = getDefaultConfig(__dirname);

module.exports = withAgentReactDevTools(config);
