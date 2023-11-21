// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require('aws-sdk');
const https = require('https');
const Sharp = require('sharp');


const S3 = new AWS.S3({
  signatureVersion: 'v4',
  httpOptions: { agent: new https.Agent({ keepAlive: true }) },
});
const S3_ORIGINAL_IMAGE_BUCKET = process.env.originalImageBucketName;
const S3_TRANSFORMED_IMAGE_BUCKET = process.env.transformedImageBucketName;
const TRANSFORMED_IMAGE_CACHE_TTL = process.env.transformedImageCacheTTL;
const SECRET_KEY = process.env.secretKey;
const LOG_TIMING = process.env.logTiming;
const ALLOWED_PRESETS = {
  icon: 'icon',
  thumb: 'thumb',
  small: 'small',
  medium: 'medium',
  large: 'large',
  xlarge: 'xlarge',
  icon_wide: 'icon_wide',
  thumb_wide: 'thumb_wide',
  small_wide: 'small_wide',
  medium_wide: 'medium_wide',
  large_wide: 'large_wide',
  xlarge_wide: 'xlarge_wide',
  doordash: 'doordash'
};

exports.handler = async (event) => {
  // An example of expected path is /images/rio/1.jpeg/format=auto,width=100 or /images/rio/1.jpeg/original where /images/rio/1.jpeg is the path of the original image
  var imagePathArray = event.requestContext.http.path.split('/');
  // get the requested image operations
  var operationsPrefix = imagePathArray.pop();
  // get the original image path images/rio/1.jpg
  imagePathArray.shift();
  var originalImagePath = imagePathArray.join('/');
  // timing variable
  var timingLog = "perf ";
  var startTime = performance.now();
  // Downloading original image
  let originalImage;
  let contentType;
  try {
    originalImage = await S3.getObject({ Bucket: S3_ORIGINAL_IMAGE_BUCKET, Key: originalImagePath }).promise();
    contentType = originalImage.ContentType;
  } catch (error) {
    return sendError(500, 'error downloading original image', error);
  }
  let transformedImage = Sharp(originalImage.Body, { failOn: 'none', animated: true });
  // Get image orientation to rotate if needed
  const imageMetadata = await transformedImage.metadata();
  //  execute the requested operations
  const operationsJSON = Object.fromEntries(operationsPrefix.split(',').map(operation => operation.split('=')));
  timingLog = timingLog + parseInt(performance.now() - startTime) + ' ';
  startTime = performance.now();
  try {
    let format = 'jpeg';
    let quality = '80';
    // check if resizing is requested
    var resizingOptions = {};
    if (operationsJSON['preset']) {
      switch (operationsJSON['preset']) {
        case ALLOWED_PRESETS.icon:
          resizingOptions.width = 32;
          resizingOptions.height = 32;
          format = 'jpeg';
          quality = '10';
          break;
        case ALLOWED_PRESETS.thumb:
          resizingOptions.width = 50;
          resizingOptions.height = 50;
          format = 'jpeg';
          quality = '20';
          break;
        case ALLOWED_PRESETS.large:
          resizingOptions.width = 1024;
          resizingOptions.height = 1024;
          format = 'jpeg';
          quality = '80';
          break;
        case ALLOWED_PRESETS.medium:
          resizingOptions.width = 512;
          resizingOptions.height = 512;
          format = 'jpeg';
          quality = '70';
          break;
        case ALLOWED_PRESETS.small:
          resizingOptions.width = 256;
          resizingOptions.height = 256;
          format = 'jpeg';
          quality = '50';
          break;
        case ALLOWED_PRESETS.xlarge:
          resizingOptions.width = 2048;
          resizingOptions.height = 2048;
          format = 'jpeg';
          quality = '90';
          break;
        case ALLOWED_PRESETS.icon_wide:
          resizingOptions.width = 32;
          resizingOptions.height = 18;
          format = 'jpeg';
          quality = '10';
          break;
        case ALLOWED_PRESETS.thumb_wide:
          resizingOptions.width = 50;
          resizingOptions.height = 28;
          format = 'jpeg';
          quality = '20';
          break;
        case ALLOWED_PRESETS.large_wide:
          resizingOptions.width = 1024;
          resizingOptions.height = 576;
          format = 'jpeg';
          quality = '80';
          break;
        case ALLOWED_PRESETS.medium_wide:
          resizingOptions.width = 512;
          resizingOptions.height = 288;
          format = 'jpeg';
          quality = '70';
          break;
        case ALLOWED_PRESETS.small_wide:
          resizingOptions.width = 256;
          resizingOptions.height = 144;
          format = 'jpeg';
          quality = '50';
          break;
        case ALLOWED_PRESETS.doordash:
          resizingOptions.width = 1400;
          resizingOptions.height = 788;
          format = 'jpeg';
          quality = '70';
          break;
        case ALLOWED_PRESETS.xlarge_wide:
        default:
          resizingOptions.width = 2048;
          resizingOptions.height = 1152;
          format = 'jpeg';
          quality = '80';
          break;
      }
    }
    if (resizingOptions) {
      transformedImage = transformedImage.resize(resizingOptions);
    }
    // check if formatting is requested
    let isLossy = false;
    switch (format) {
      case 'jpeg':
        contentType = 'image/jpeg';
        isLossy = true;
        break;
      case 'jpg':
        contentType = 'image/jpg';
        isLossy = true;
        break;
      case 'gif':
        contentType = 'image/gif';
        break;
      case 'webp':
        contentType = 'image/webp';
        isLossy = true;
        break;
      case 'png':
        contentType = 'image/png';
        break;
      case 'avif':
        contentType = 'image/avif';
        isLossy = true;
        break;
      default:
        contentType = 'image/jpeg';
        isLossy = true;
    }
    transformedImage = transformedImage.toFormat(format, {
      quality: parseInt(quality),
    });
    transformedImage = await transformedImage.toBuffer();
  } catch (error) {
    return sendError(500, 'error transforming image', error);
  }
  timingLog = timingLog + parseInt(performance.now() - startTime) + ' ';
  startTime = performance.now();
  // upload transformed image back to S3 if required in the architecture
  if (S3_TRANSFORMED_IMAGE_BUCKET) {
    try {
      await S3.putObject({
        Body: transformedImage,
        Bucket: S3_TRANSFORMED_IMAGE_BUCKET,
        Key: originalImagePath + '/' + operationsPrefix,
        ContentType: contentType,
        Metadata: {
          'cache-control': TRANSFORMED_IMAGE_CACHE_TTL,
        },
      }).promise();
    } catch (error) {
      sendError('APPLICATION ERROR', 'Could not upload transformed image to S3', error);
    }
  }
  timingLog = timingLog + parseInt(performance.now() - startTime) + ' ';
  if (LOG_TIMING === 'true') console.log(timingLog);
  // return transformed image
  return {
    statusCode: 200,
    body: transformedImage.toString('base64'),
    isBase64Encoded: true,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': TRANSFORMED_IMAGE_CACHE_TTL
    }
  };
};

function sendError(statusCode, body, error) {
  console.log('APPLICATION ERROR', body);
  console.log(error);
  return { statusCode: 200, body };
}
