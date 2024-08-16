module.exports = {
    testEnvironment: 'node',
    reporters: [
      'default',
      ['jest-html-reporters', {
        publicPath: './html-report',
        filename: 'report.html',
        expand: true,
        pageTitle: 'API Load Test Report',
        hideIcon: false,
        openReport: true,
      }],
    ],
    testTimeout: 300000, 
  };
  