// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { S3 } = require('@aws-sdk/client-s3');

const https = require('https');
const Sharp = require('sharp');

const S3Instance = new S3({
    // The key signatureVersion is no longer supported in v3, and can be removed.
    // @deprecated SDK v3 only supports signature v4.
    signatureVersion: 'v4',

    // The transformation for httpOptions is not implemented.
    // Refer to UPGRADING.md on aws-sdk-js-v3 for changes needed.
    // Please create/upvote feature request on aws-sdk-js-codemod for httpOptions.
    httpOptions: { agent: new https.Agent({ keepAlive: true }) },
});
const S3_ORIGINAL_IMAGE_BUCKET = process.env.originalImageBucketName;
const S3_TRANSFORMED_IMAGE_BUCKET = process.env.transformedImageBucketName;
const TRANSFORMED_IMAGE_CACHE_TTL = process.env.transformedImageCacheTTL;
const SECRET_KEY = process.env.secretKey;
const ALLOWED_PRESETS = {
  thumb: 'thumb',
  small: 'small',
  medium: 'medium',
  large: 'large',
  xlarge: 'xlarge',
  small_wide: 'small_wide',
  medium_wide: 'medium_wide',
  large_wide: 'large_wide',
  xlarge_wide: 'xlarge_wide',
  doordash: 'doordash'
};

exports.handler = async (event) => {
  // First validate if the request is coming from CloudFront
  if (!event.headers['x-origin-secret-header'] || !(event.headers['x-origin-secret-header'] === SECRET_KEY)) {
    return sendError(403, 'Request unauthorized', event);
  }
  // Validate if this is a GET request
  if (!event.requestContext || !event.requestContext.http || !(event.requestContext.http.method === 'GET')) {
    return sendError(400, 'Only GET method is supported', event);
  }
  // An example of expected path is /images/rio/1.jpeg/format=auto,width=100 or /images/rio/1.jpeg/original where /images/rio/1.jpeg is the path of the original image
  var imagePathArray = event.requestContext.http.path.split('/');
  // get the requested image operations
  var operationsPrefix = imagePathArray.pop();
  // get the original image path images/rio/1.jpg
  imagePathArray.shift();
  var originalImagePath = imagePathArray.join('/');
  // Downloading original image
  let originalImage;
  let contentType;
  try {
    originalImage = await S3Instance.getObject({ Bucket: S3_ORIGINAL_IMAGE_BUCKET, Key: originalImagePath }).promise();
    contentType = originalImage.ContentType;
  } catch (error) {
    return sendError(500, 'error downloading original image', error);
  }
  let transformedImage = Sharp(originalImage.Body, { failOn: 'none', animated: true });
  // Get image orientation to rotate if needed
  const imageMetadata = await transformedImage.metadata();
  //  execute the requested operations
  const operationsJSON = Object.fromEntries(operationsPrefix.split(',').map(operation => operation.split('=')));
  try {
    let format = 'jpeg';
    let quality = '80';
    // check if resizing is requested
    var resizingOptions = {};
    if (operationsJSON['preset']) {
      switch (operationsJSON['preset']) {
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
    // upload transformed image back to S3 if required in the architecture
    if (S3_TRANSFORMED_IMAGE_BUCKET) {
        try {
            await S3Instance.putObject({
                Body: transformedImage,
                Bucket: S3_TRANSFORMED_IMAGE_BUCKET,
                Key: originalImagePath + '/' + operationsPrefix,
                ContentType: contentType,
                Metadata: {
                    'cache-control': TRANSFORMED_IMAGE_CACHE_TTL,
                },
            });
        } catch (error) {
            sendError('APPLICATION ERROR', 'Could not upload transformed image to S3', error);
        }
    }
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
  return { statusCode, body };
}
