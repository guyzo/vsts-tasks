import path = require('path');
import Q = require('q');
import tl = require('vsts-task-lib/task');

// Define error handler
var onError = function (errorMsg) {
    tl.error(errorMsg);
    tl.exit(1);
}

/*
Signing the specified file.  Move the current file to fn.unsigned, and
place the signed file at the same location fn
*/
var jarsigning = (fn: string) => {
    // file must exist
    tl.checkPath(fn, 'file to sign');

    var jarsigner = tl.which("jarsigner", false);
    if (!jarsigner) {
        var java_home = tl.getVariable('JAVA_HOME');
        if (!java_home) {
            onError(tl.loc('JavaHomeNotSet'));
        }

        jarsigner = path.join(java_home, 'bin', 'jarsigner');
    }

    var jarsignerRunner = tl.createToolRunner(jarsigner);

    // Get keystore file for signing
    var keystoreFile = tl.getInput('keystoreFile', true);

    // Get keystore alias
    var keystoreAlias = tl.getInput('keystoreAlias', true);

    var keystorePass = tl.getInput('keystorePass', false);

    var keyPass = tl.getInput('keyPass', false);

    var jarsignerArguments = tl.getInput('jarsignerArguments', false);

    jarsignerRunner.arg(['-keystore', keystoreFile]);

    if (keystorePass) {
        jarsignerRunner.arg(['-storepass', keystorePass]);
    }

    if (keyPass) {
        jarsignerRunner.arg(['-keypass', keyPass]);
    }

    if (jarsignerArguments) {
        jarsignerRunner.argString(jarsignerArguments);
    }

    var unsignedFn = fn + ".unsigned"; 
    var success = tl.mv(fn, unsignedFn, true, false);

    jarsignerRunner.arg(['-signedjar', fn, unsignedFn, keystoreAlias]);
    
    return jarsignerRunner.exec(null);
}

/*
Zipaligning apk
*/
var zipaligning = (fn: string) => {
    // file must exist
    tl.checkPath(fn, 'file to zipalign');

    var zipaligner = tl.getInput('zipalignLocation', false);

    // if the tool path is not set, let's find one (anyone) from the SDK folder
    if (!zipaligner) {
        
        var android_home = tl.getVariable('ANDROID_HOME');
        if (!android_home) {
            onError(tl.loc('AndroidHomeNotSet'));
        }
    
        var allFiles = tl.find(path.join(android_home, 'build-tools'));
        // Now matching the pattern against all files
        var zipalignToolsList = tl.match(allFiles, "zipalign*", {matchBase: true});

        if (!zipalignToolsList || zipalignToolsList.length === 0) {
            onError(tl.loc('CouldNotFindZipalignInAndroidHome', android_home));
        }

        zipaligner = zipalignToolsList[0];
    }

    if (!zipaligner) {
         onError(tl.loc('CouldNotFindZipalign'));
    }

    var zipalignRunner = tl.createToolRunner(zipaligner);

    // alignment must be 4 or play store will reject, hard code this to avoid user errors
    zipalignRunner.arg(["-v", "4"]);

    var unalignedFn = fn + ".unaligned"; 
    var success = tl.mv(fn, unalignedFn, true, false);
    
    zipalignRunner.arg([unalignedFn, fn]);
    return zipalignRunner.exec(null);
}

var process = (fn: string) => {

    tl.debug('process '+fn);

    return Q.fcall(() => {
       if (jarsign) {
           return jarsigning(fn);
       }

       return Q(0);
    })
    .then(() => {
        if (zipalign) {
            return zipaligning(fn);
        }

        return Q(0);
    })
}

//-----------------------------------------------------------------------------
// Program
//-----------------------------------------------------------------------------
// Configure localization
tl.setResourcePath(path.join(__dirname, 'task.json'));

// Get files to be signed 
var filesPattern = tl.getInput('files', true);

// Signing the APK?
var jarsign: boolean = tl.getBoolInput('jarsign');

// Zipaligning the APK?
var zipalign: boolean = tl.getBoolInput('zipalign');

// Resolve files for the specified value or pattern
if (filesPattern.indexOf('*') == -1 && filesPattern.indexOf('?') == -1) {
    // No pattern found, check literal path to a single file
    tl.checkPath(filesPattern, 'files');

    // Use the specified single file
    var filesList = [filesPattern];

} else {
    var firstWildcardIndex = function(str) {
        var idx = str.indexOf('*');

        var idxOfWildcard = str.indexOf('?');
        if (idxOfWildcard > -1) {
            return (idx > -1) ?
                Math.min(idx, idxOfWildcard) : idxOfWildcard;
        }

        return idx;
    }

    // Find app files matching the specified pattern
    tl.debug('Matching glob pattern: ' + filesPattern);

    // First find the most complete path without any matching patterns
    var idx = firstWildcardIndex(filesPattern);
    tl.debug('Index of first wildcard: ' + idx);
    var findPathRoot = path.dirname(filesPattern.slice(0, idx));

    tl.debug('find root dir: ' + findPathRoot);

    // Now we get a list of all files under this root
    var allFiles = tl.find(findPathRoot);

    // Now matching the pattern against all files
    var filesList: string[] = tl.match(allFiles, filesPattern, {matchBase: true});

    // Fail if no matching app files were found
    if (!filesList || filesList.length == 0) {
        onError(tl.loc('NoMatchingFiles', filesPattern));
    }
}

var result = Q({});
filesList.forEach((fn) => {
    result = result.then(() => {
        return process(fn);
    })
})

result.then(() => {
    tl.exit(0);
})
.fail((err) => {
    tl.error(err);
    tl.exit(1);
});
