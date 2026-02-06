const fs = require('fs');
const path = require('path');
const ci = require('miniprogram-ci');

const rootPath = path.resolve(__dirname, '..');
const projectConfigPath = path.join(rootPath, 'project.config.json');
const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));

const appid = process.env.WX_APPID || projectConfig.appid;
const privateKeyPath =
  process.env.WX_PRIVATE_KEY_PATH || path.join(rootPath, '.keys', 'private.key');

if (!appid) {
  throw new Error('Missing WeChat appid. Set WX_APPID or project.config.json.');
}

if (!fs.existsSync(privateKeyPath)) {
  throw new Error(
    `Missing private key file at ${privateKeyPath}. Set WX_PRIVATE_KEY_PATH.`
  );
}

const version =
  process.env.WX_VERSION ||
  `ci-${process.env.GITHUB_RUN_NUMBER || Date.now()}`;
const desc =
  process.env.WX_DESC || `CI upload ${new Date().toISOString()}`;

const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath: rootPath,
  privateKeyPath,
});

const setting = {
  es6: projectConfig.setting?.es6 ?? true,
  minify: projectConfig.setting?.minified ?? true,
  autoAudits: projectConfig.setting?.autoAudits ?? false,
  minifyWXML: projectConfig.setting?.minifyWXML ?? true,
  minifyWXSS: projectConfig.setting?.minifyWXSS ?? true,
  uglifyFileName: projectConfig.setting?.uglifyFileName ?? false,
};

ci.upload({
  project,
  version,
  desc,
  setting,
  onProgressUpdate: console.log,
})
  .then(() => {
    console.log('Experience upload completed.');
  })
  .catch((error) => {
    console.error('Experience upload failed.', error);
    process.exit(1);
  });
