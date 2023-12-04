// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

function handler(event) {
  var ALLOWED_PRESETS = ['thumb', 'small', 'medium', 'large', 'xlarge', 'small_wide', 'medium_wide', 'large_wide', 'xlarge_wide', 'doordash']
  var request = event.request;
  var originalImagePath = request.uri;
  //  validate, process and normalize the requested operations in query parameters
  var normalizedOperations = {};
  if (request.querystring) {
    Object.keys(request.querystring).forEach(operation => {
      switch (operation.toLowerCase()) {
        case 'preset':
          if (request.querystring[operation]['value']) {
            var preset = request.querystring[operation]['value'];
            // you can protect the Lambda function by checking that the requested preset is in the list of allowed presets;
            if (preset && ALLOWED_PRESETS.includes(preset.toLowerCase())) {
              normalizedOperations['preset'] = preset.toLowerCase();
            }
          } 
          break;
      
        default: break;
      }
    });
      //rewrite the path to normalized version if valid operations are found
      if (Object.keys(normalizedOperations).length > 0) {
        // put them in order
        var normalizedOperationsArray = [];
        if (normalizedOperations.preset) normalizedOperationsArray.push('preset='+normalizedOperations.preset);
        request.uri = originalImagePath + '/' + normalizedOperationsArray.join(',');     
      } else {
        // If no valid operation is found, flag the request with /original path suffix
        request.uri = originalImagePath + '/original';     
      }

  } else {
    // If no query strings are found, flag the request with /original path suffix
    request.uri = originalImagePath + '/original'; 
  }
  // remove query strings
  request['querystring'] = {};
  return request;
}
